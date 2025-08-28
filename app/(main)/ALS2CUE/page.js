"use client";
import React, { useState, useContext } from 'react';
import FileDrop from '../FileDrop/FileDrop';
import styles from './ALS2CUE.module.css';
import { ColorContext } from '../ColorContext';

export default function ALS2CUEPage() {
  const { colors } = useContext(ColorContext);
  const [selectedFile, setSelectedFile] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [cueOutput, setCueOutput] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [rawXml, setRawXml] = useState('');

  // Function to calculate readable text color based on background color
  const getReadableTextColor = (backgroundColor) => {
    if (!backgroundColor) return '#000000';
    
    // Remove "#" and parse hex color values
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    
    // Convert to relative luminance (WCAG 2.1 formula)
    const rsRGB = r / 255;
    const gsRGB = g / 255;
    const bsRGB = b / 255;
    
    const rL = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
    const gL = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
    const bL = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
    
    const luminance = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
    
    // Calculate contrast ratios for both black and white text
    const blackContrast = (luminance + 0.05) / (0 + 0.05);
    const whiteContrast = (1 + 0.05) / (luminance + 0.05);
    
    // Choose the color with the highest contrast ratio
    if (blackContrast > whiteContrast) {
      return '#000000'; // Black text
    } else {
      return '#ffffff'; // White text
    }
  };

  // Get colors with fallbacks
  const heroBgColor = colors?.Muted || '#667eea';
  const sectionBgColor = colors?.LightMuted || '#ffffff';
  const cardBgColor = colors?.Muted || '#f8f9fa';
  const accentColor = colors?.Vibrant || '#007bff';
  
  // Get readable text colors
  const heroTextColor = getReadableTextColor(heroBgColor);
  const sectionTextColor = getReadableTextColor(sectionBgColor);
  const cardTextColor = getReadableTextColor(cardBgColor);

  const handleFilesSelected = (files) => {
    const alsFile = Array.from(files).find(file => file.name.endsWith('.als'));
    if (alsFile) {
      setSelectedFile(alsFile);
      setError(null);
      setMarkers([]);
      setCueOutput('');
      setDebugInfo('');
      setRawXml('');
    } else {
      setError('Please select a valid .als file');
    }
  };

  const parseStartTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const processALSFile = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setError(null);
    setDebugInfo('');

    try {
      // Read the file as ArrayBuffer
      const arrayBuffer = await selectedFile.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Check if it's a gzipped file (ALS files are gzipped)
      if (uint8Array[0] === 0x1f && uint8Array[1] === 0x8b) {
        setDebugInfo('File is gzipped, decompressing...');
        
        // Decompress using pako
        const pako = await import('pako');
        const decompressed = pako.inflate(uint8Array, { to: 'string' });
        
        setDebugInfo('File decompressed successfully. XML length: ' + decompressed.length + ' characters');
        setRawXml(decompressed);
        
        // Parse the XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(decompressed, 'text/xml');
        
        setDebugInfo(prev => prev + '\nXML parsed successfully. Root element: ' + xmlDoc.documentElement.tagName);
        
        const extractedMarkers = [];
        let debugMsg = '';

        // Method 1: Look for Locators (this is what dawtool actually does!)
        // This is the key insight - dawtool looks for user-created markers, not tracks
        const locatorsElements = xmlDoc.querySelectorAll('Locators');
        debugMsg += `Found ${locatorsElements.length} Locators elements\n`;
        
        if (locatorsElements.length > 0) {
          locatorsElements.forEach((locatorsContainer, containerIndex) => {
            // Look for individual Locator elements within the Locators container
            const individualLocators = locatorsContainer.querySelectorAll('Locator');
            debugMsg += `Locators container ${containerIndex + 1} has ${individualLocators.length} individual locators\n`;
            
            individualLocators.forEach((locator, index) => {
              // Get the Time attribute value (this is in beats, not seconds)
              const timeElement = locator.querySelector('Time');
              const nameElement = locator.querySelector('Name');
              
              if (timeElement && nameElement) {
                const beatTime = timeElement.getAttribute('Value');
                const markerName = nameElement.getAttribute('Value');
                
                if (beatTime && !isNaN(parseFloat(beatTime)) && markerName) {
                  // Convert beat time to seconds (assuming 120 BPM for now)
                  // In a real implementation, you'd parse the tempo from the XML
                  const bpm = 120; // Default BPM
                  const startTime = (parseFloat(beatTime) * 60) / bpm;
                  
                  debugMsg += `Locator ${index + 1}: name="${markerName}", beatTime="${beatTime}", converted=${startTime.toFixed(3)}s (BPM: ${bpm})\n`;
                  
                  extractedMarkers.push({
                    name: markerName,
                    startTime,
                    formattedTime: parseStartTime(startTime)
                  });
                }
              }
            });
          });
        }

        // Method 2: If no locators found, look for any element with Time and Name attributes
        if (extractedMarkers.length === 0) {
          const timeNameElements = xmlDoc.querySelectorAll('[Time][Name]');
          debugMsg += `Found ${timeNameElements.length} elements with both Time and Name attributes\n`;
          
          timeNameElements.forEach((element, index) => {
            const timeValue = element.getAttribute('Time');
            const nameValue = element.getAttribute('Name');
            
            if (timeValue && nameValue && !isNaN(parseFloat(timeValue))) {
              const startTime = parseFloat(timeValue);
              const name = nameValue;
              
              debugMsg += `Time+Name element ${index + 1}: tag="${element.tagName}", name="${name}", time="${timeValue}", seconds=${startTime.toFixed(3)}s\n`;
              
              extractedMarkers.push({
                name,
                startTime,
                formattedTime: parseStartTime(startTime)
              });
            }
          });
        }

        // Method 3: Look for any element with a Time attribute that might be a marker
        if (extractedMarkers.length === 0) {
          const timeElements = xmlDoc.querySelectorAll('[Time]');
          debugMsg += `Found ${timeElements.length} elements with Time attribute\n`;
          
          // Filter for reasonable time values (between 0 and 3600 seconds = 1 hour)
          timeElements.forEach((element, index) => {
            const timeValue = element.getAttribute('Time');
            if (timeValue && !isNaN(parseFloat(timeValue))) {
              const startTime = parseFloat(timeValue);
              if (startTime >= 0 && startTime <= 3600) {
                const name = element.tagName + ' ' + (index + 1);
                
                debugMsg += `Time element ${index + 1}: tag="${element.tagName}", time="${timeValue}", seconds=${startTime.toFixed(3)}s\n`;
                
                extractedMarkers.push({
                  name,
                  startTime,
                  formattedTime: parseStartTime(startTime)
                });
              }
            }
          });
        }

        setDebugInfo(prev => prev + '\n' + debugMsg);
        
        // Filter out duplicates and sort by time
        const filteredMarkers = [];
        const seenTimes = new Set();
        
        extractedMarkers.forEach((marker) => {
          // Skip if we've already seen this time (within 1 second tolerance)
          const timeKey = Math.floor(marker.startTime);
          if (seenTimes.has(timeKey)) return;
          
          seenTimes.add(timeKey);
          filteredMarkers.push(marker);
        });
        
        // Sort by start time
        filteredMarkers.sort((a, b) => a.startTime - b.startTime);
        
        setMarkers(filteredMarkers);
        
        // Generate CUE file content
        if (filteredMarkers.length > 0) {
          let cueContent = `TITLE "${selectedFile.name.replace('.als', '')}"\n`;
          cueContent += `PERFORMER "Unknown Artist"\n`;
          cueContent += `FILE "${selectedFile.name.replace('.als', '.wav')}" WAVE\n\n`;
          
          filteredMarkers.forEach((marker, index) => {
            cueContent += `TRACK ${(index + 1).toString().padStart(2, '0')} AUDIO\n`;
            cueContent += `TITLE "${marker.name}"\n`;
            cueContent += `PERFORMER "Unknown Artist"\n`;
            cueContent += `INDEX 01 ${marker.formattedTime}\n\n`;
          });
          
          setCueOutput(cueContent);
        } else {
          setError('No markers found in the ALS file. The file structure might be different than expected.');
        }
      } else {
        setError('Invalid ALS file format. Expected a gzipped file.');
      }
    } catch (err) {
      console.error('Error processing ALS file:', err);
      setError('Error processing the ALS file. Please check if it\'s a valid Ableton Live Set file.');
      setDebugInfo('Error: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadCueFile = () => {
    if (!cueOutput) return;
    
    const blob = new Blob([cueOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFile.name.replace('.als', '')}.cue`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyXmlToClipboard = async () => {
    if (!rawXml) return;
    
    try {
      await navigator.clipboard.writeText(rawXml);
      // Show a temporary success message
      const originalText = document.querySelector(`.${styles.copyXmlButton}`)?.textContent || 'Copy XML to Clipboard';
      const button = document.querySelector(`.${styles.copyXmlButton}`);
      if (button) {
        button.textContent = 'Copied!';
        button.style.background = '#28a745';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '#007bff';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = rawXml;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      const button = document.querySelector(`.${styles.copyXmlButton}`);
      if (button) {
        button.textContent = 'Copied!';
        button.style.background = '#28a745';
        setTimeout(() => {
          button.textContent = 'Copy XML to Clipboard';
          button.style.background = '#007bff';
        }, 2000);
      }
    }
  };

  const generateTimestampsOutput = () => {
    if (markers.length === 0) return '';
    
    let output = '';
    markers.forEach((marker, index) => {
      // Generate clean numbered output like timestamps.me
      output += `[${marker.formattedTime}] ${index + 1}\n`;
    });
    output += `(timestamps made with https://timestamps.me)`;
    return output;
  };

  const copyTimestampsToClipboard = async () => {
    const timestampsOutput = generateTimestampsOutput();
    if (!timestampsOutput) return;
    
    try {
      await navigator.clipboard.writeText(timestampsOutput);
      // Show a temporary success message
      const originalText = document.querySelector(`.${styles.copyTimestampsButton}`)?.textContent || 'Copy Timestamps to Clipboard';
      const button = document.querySelector(`.${styles.copyTimestampsButton}`);
      if (button) {
        button.textContent = 'Copied!';
        button.style.background = '#28a745';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '#007bff';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = timestampsOutput;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      const button = document.querySelector(`.${styles.copyTimestampsButton}`);
      if (button) {
        button.textContent = 'Copied!';
        button.style.background = '#28a745';
        setTimeout(() => {
          button.textContent = 'Copy Timestamps to Clipboard';
          button.style.background = '#007bff';
        }, 2000);
      }
    }
  };

  return (
    <main className={styles.als2cueMain}>
      <section 
        className={styles.heroSection}
        style={{ 
          background: heroBgColor,
          color: heroTextColor
        }}
      >
        <h1>ALS to CUE Converter</h1>
        <p className={styles.heroDescription}>
          Convert Ableton Live Set (.als) files to CUE format to extract marker start times.
          Upload your .als file and get a formatted CUE file with all your project markers.
        </p>
      </section>

      <section 
        className={styles.uploadSection}
        style={{ 
          background: sectionBgColor,
          color: sectionTextColor
        }}
      >
        <h2>Upload ALS File</h2>
        <FileDrop onFilesSelected={handleFilesSelected} />
        
        {selectedFile && (
          <div 
            className={styles.fileInfo}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderLeftColor: accentColor
            }}
          >
            <h3>Selected File:</h3>
            <p><strong>Name:</strong> {selectedFile.name}</p>
            <p><strong>Size:</strong> {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
            <p><strong>Type:</strong> {selectedFile.type || 'application/octet-stream'}</p>
          </div>
        )}

        {error && (
          <div 
            className={styles.error}
            style={{ 
              background: colors?.DarkMuted || '#f8d7da',
              color: getReadableTextColor(colors?.DarkMuted || '#f8d7da'),
              borderColor: getReadableTextColor(colors?.DarkMuted || '#f8d7da')
            }}
          >
            <p>Error: {error}</p>
          </div>
        )}

        {debugInfo && (
          <div 
            className={styles.debugInfo}
            style={{ 
              background: colors?.LightVibrant || '#e7f3ff',
              color: getReadableTextColor(colors?.LightVibrant || '#e7f3ff'),
              borderColor: getReadableTextColor(colors?.LightVibrant || '#e7f3ff')
            }}
          >
            <h3>Debug Information:</h3>
            <pre>{debugInfo}</pre>
          </div>
        )}

        {rawXml && (
          <div 
            className={styles.rawXml}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderColor: getReadableTextColor(cardBgColor)
            }}
          >
            <div className={styles.rawXmlHeader}>
              <h3>Raw XML Content:</h3>
              <button 
                onClick={copyXmlToClipboard}
                className={styles.copyXmlButton}
                style={{ background: accentColor }}
                title="Copy the full XML content to clipboard"
              >
                Copy XML to Clipboard
              </button>
            </div>
            <details>
              <summary style={{ color: accentColor }}>Click to expand XML (may be very long)</summary>
              <pre style={{ 
                background: sectionBgColor,
                borderColor: getReadableTextColor(sectionBgColor)
              }}>{rawXml}</pre>
            </details>
          </div>
        )}

        {selectedFile && (
          <button 
            onClick={processALSFile}
            disabled={isProcessing}
            className={styles.processButton}
            style={{ background: accentColor }}
          >
            {isProcessing ? 'Processing...' : 'Process ALS File'}
          </button>
        )}
      </section>

      {markers.length > 0 && (
        <section 
          className={styles.resultsSection}
          style={{ 
            background: sectionBgColor,
            color: sectionTextColor
          }}
        >
          <h2>Extracted Markers</h2>
          <div className={styles.markersTable}>
            <table style={{ 
              background: cardBgColor,
              border: `1px solid ${getReadableTextColor(cardBgColor)}`
            }}>
              <thead>
                <tr>
                  <th style={{ 
                    background: getReadableTextColor(cardBgColor),
                    color: cardBgColor,
                    borderBottomColor: getReadableTextColor(cardBgColor)
                  }}>#</th>
                  <th style={{ 
                    background: getReadableTextColor(cardBgColor),
                    color: cardBgColor,
                    borderBottomColor: getReadableTextColor(cardBgColor)
                  }}>Name</th>
                  <th style={{ 
                    background: getReadableTextColor(cardBgColor),
                    color: cardBgColor,
                    borderBottomColor: getReadableTextColor(cardBgColor)
                  }}>Start Time</th>
                  <th style={{ 
                    background: getReadableTextColor(cardBgColor),
                    color: cardBgColor,
                    borderBottomColor: getReadableTextColor(cardBgColor)
                  }}>Formatted Time</th>
                </tr>
              </thead>
              <tbody>
                {markers.map((marker, index) => (
                  <tr key={index} style={{ 
                    background: cardBgColor,
                    color: cardTextColor
                  }}>
                    <td style={{ borderBottomColor: getReadableTextColor(cardBgColor) }}>{index + 1}</td>
                    <td style={{ borderBottomColor: getReadableTextColor(cardBgColor) }}>{marker.name}</td>
                    <td style={{ borderBottomColor: getReadableTextColor(cardBgColor) }}>{marker.startTime.toFixed(3)}s</td>
                    <td style={{ borderBottomColor: getReadableTextColor(cardBgColor) }}>{marker.formattedTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div 
            className={styles.timestampsOutput}
            style={{ borderTopColor: getReadableTextColor(sectionBgColor) }}
          >
            <h3>Timestamps Output (timestamps.me style)</h3>
            <div 
              className={styles.timestampsPreview}
              style={{ 
                background: cardBgColor,
                color: cardTextColor,
                borderColor: getReadableTextColor(cardBgColor)
              }}
            >
              <pre>{generateTimestampsOutput()}</pre>
            </div>
            <button 
              onClick={copyTimestampsToClipboard} 
              className={styles.copyTimestampsButton}
              style={{ background: accentColor }}
            >
              Copy Timestamps to Clipboard
            </button>
          </div>
        </section>
      )}

      {cueOutput && (
        <section 
          className={styles.cueSection}
          style={{ 
            background: sectionBgColor,
            color: sectionTextColor
          }}
        >
          <h2>Generated CUE File</h2>
          <div 
            className={styles.cuePreview}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderColor: getReadableTextColor(cardBgColor)
            }}
          >
            <pre>{cueOutput}</pre>
          </div>
          <button 
            onClick={downloadCueFile} 
            className={styles.downloadButton}
            style={{ background: colors?.DarkVibrant || '#28a745' }}
          >
            Download CUE File
          </button>
        </section>
      )}

      <section 
        className={styles.infoSection}
        style={{ 
          background: sectionBgColor,
          color: sectionTextColor
        }}
      >
        <h2>About ALS to CUE Conversion</h2>
        <div className={styles.infoGrid}>
          <div 
            className={styles.infoCard}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderLeftColor: accentColor
            }}
          >
            <h3>What is an ALS file?</h3>
            <p>
              An ALS (Ableton Live Set) file is a compressed XML file that contains all the 
              information about an Ableton Live project, including tracks, clips, markers, and timing data.
            </p>
          </div>
          
          <div 
            className={styles.infoCard}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderLeftColor: accentColor
            }}
          >
            <h3>What is a CUE file?</h3>
            <p>
              A CUE file is a text-based format that contains track information for audio CDs or 
              digital audio files, including track titles, start times, and performer information.
            </p>
          </div>
          
          <div 
            className={styles.infoCard}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderLeftColor: accentColor
            }}
          >
            <h3>How it works</h3>
            <p>
              The converter decompresses the .als file, parses the XML structure to find markers 
              and timing information, then generates a properly formatted .cue file with all the 
              extracted data.
            </p>
          </div>
          
          <div 
            className={styles.infoCard}
            style={{ 
              background: cardBgColor,
              color: cardTextColor,
              borderLeftColor: accentColor
            }}
          >
            <h3>Privacy</h3>
            <p>
              All processing happens in your browser. Your .als files are never uploaded to any server 
              and remain completely private.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
