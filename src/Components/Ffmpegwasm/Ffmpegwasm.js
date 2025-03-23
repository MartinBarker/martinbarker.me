import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';
import styles from './Ffmpegwasm.module.css'; // Import the CSS module
import Table from "../Table/Table.js";
import ImageModal from '../ImageModal/ImageModal';
import RenderOptions from '../RenderOptions/RenderOptions';
import TemplateSelector from '../TemplateSelector/TemplateSelector';

// Polyfill for SharedArrayBuffer
if (typeof SharedArrayBuffer === 'undefined') {
  window.SharedArrayBuffer = ArrayBuffer;
}

function Ffmpegwasm() {
  // Add new state for base64 data
  const [imageBase64Map, setImageBase64Map] = useState({});
  
  const [videoSrc, setVideoSrc] = useState('');
  const [message, setMessage] = useState('Click Load to load ffmpeg');
  const [audioFiles, setAudioFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [selectedAudioFiles, setSelectedAudioFiles] = useState([]);
  const [selectedImageFiles, setSelectedImageFiles] = useState([]);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [resolution, setResolution] = useState('1920x1080');
  const [totalFileSize, setTotalFileSize] = useState(0);
  const [outputFileSize, setOutputFileSize] = useState(0);
  const [ffmpegCommand, setFfmpegCommand] = useState([]);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [durations, setDurations] = useState([]);
  const [allDurationsCalculated, setAllDurationsCalculated] = useState(false);
  const [renderClicked, setRenderClicked] = useState(false);
  const [imageRowSelection, setImageRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [modalImage, setModalImage] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('combine');
  const [showLogs, setShowLogs] = useState(true); // Set to true by default
  const [ffmpegLogs, setFfmpegLogs] = useState([]);
  const [renderButtonEnabled, setRenderButtonEnabled] = useState(false);
  const [isRendering, setIsRendering] = useState(false); // Add new state for rendering
  const ffmpeg = useMemo(() => createFFmpeg({ log: true }), []);
  const fileInputRef = useRef(null);

  const audioExtensions = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'aiff', 'wma', 'amr', 'opus', 'alac', 'pcm', 'mid', 'midi', 'aif', 'caf'];
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp', 'heif', 'heic', 'ico', 'svg', 'raw', 'cr2', 'nef', 'orf', 'arw', 'raf', 'dng', 'pef', 'sr2'];

  const Thumbnail = ({ src }) => {
    const [imageUrl, setImageUrl] = useState('');

    useEffect(() => {
      if (!(src instanceof File)) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        setImageUrl(e.target.result);
      };
      reader.readAsDataURL(src);

      return () => {
        reader.abort();
        if (imageUrl) {
          URL.revokeObjectURL(imageUrl);
        }
      };
    }, [src]);

    if (!imageUrl) {
      return null;
    }

    return (
      <div className={styles.thumbnailContainer}>
        <img
          src={imageUrl}
          alt="thumbnail"
          className={styles.thumbnailImage}
        />
      </div>
    );
  };

  const ImageThumbnail = React.memo(({ file }) => {
    const [uploadedImage, setUploadedImage] = useState('');

    useEffect(() => {
      if (file instanceof File) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setUploadedImage(e.target.result);
        };
        reader.readAsDataURL(file);
      }
    }, [file]);

    return (
      <div className={styles.thumbnailWrapper}>
        <img
          src={uploadedImage}
          alt="thumbnail"
          className={styles.thumbnail}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  });

  const ThumbnailCell = React.memo(({ row }) => {
    const base64Data = imageBase64Map[row.original.id];
    
    if (!base64Data) {
      return <div style={{ width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
    }

    const handleClick = () => {
      setModalImage({ 
        data: base64Data, 
        name: row.original.name,
        size: row.original.size 
      });
    };

    return (
      <div 
        className={styles.thumbnailContainer}
        onClick={handleClick}
      >
        <img 
          src={`data:image/jpeg;base64,${base64Data}`}
          alt="thumbnail" 
          style={{ 
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain'
          }}
        />
      </div>
    );
  });

  const imageColumns = [
    {
      accessorKey: 'thumbnail',
      header: 'Thumbnail',
      cell: ({ row }) => <ThumbnailCell row={row} />
    },
    {
      accessorKey: 'name',
      header: 'File Name',
      // Add a custom cell renderer to handle File objects
      cell: info => info.row.original instanceof File ? info.row.original.name : info.getValue()
    },
    {
      accessorKey: 'size',
      header: 'Size (MB)',
      cell: ({ row }) => (row.original.size / (1024 * 1024)).toFixed(2)
    }
  ];

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    processFiles(files);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    files.forEach(file => {
      if (imageExtensions.includes(file.name.split('.').pop().toLowerCase())) {
        console.log('Dropped image file:', file.name); // Print the filename
      }
    });
    processFiles(files);
  };

  const handleClick = () => {
    fileInputRef.current.click();
  };

  const printSelectionStatus = () => {
    const selectedAudios = audioFiles.filter(file => selectedAudioFiles[file.id]);
    const selectedImages = imageFiles.filter(file => imageRowSelection[file.id]);
    console.log('Selected audio files:', selectedAudios);
    console.log('Selected image files:', selectedImages);
  };

  const handleRowClick = (index, type) => {
    if (type === 'audio') {
      const newSelectedAudioFiles = [...selectedAudioFiles];
      if (newSelectedAudioFiles.includes(index)) {
        newSelectedAudioFiles.splice(newSelectedAudioFiles.indexOf(index), 1);
      } else {
        newSelectedAudioFiles.push(index);
      }
      setSelectedAudioFiles(newSelectedAudioFiles);
    } else if (type === 'image') {
      const newSelectedImageFiles = [...selectedImageFiles];
      if (newSelectedImageFiles.includes(index)) {
        newSelectedImageFiles.splice(newSelectedImageFiles.indexOf(index), 1);
      } else {
        newSelectedImageFiles.push(index);
        console.log('Selected image file:', imageFiles[index].name); // Print the filename
      }
      setSelectedImageFiles(newSelectedImageFiles);
    }
    printSelectionStatus(); // Call the method to print the status
  };

  // Load data from localStorage on component mount
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        // Load image files
        const savedImageFiles = JSON.parse(localStorage.getItem('ffmpeg_imageFiles') || '[]');
        const savedImageBase64Map = JSON.parse(localStorage.getItem('ffmpeg_imageBase64Map') || '{}');
        
        if (savedImageFiles.length > 0) {
          const reconstructedImageFiles = savedImageFiles.map(fileData => {
            return {
              ...fileData,
              id: fileData.id || `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            };
          });
          setImageFiles(reconstructedImageFiles);
          setImageBase64Map(savedImageBase64Map);
        }

        // Load audio files
        const savedAudioFiles = JSON.parse(localStorage.getItem('ffmpeg_audioFiles') || '[]');
        if (savedAudioFiles.length > 0) {
          const reconstructedAudioFiles = savedAudioFiles.map(fileData => {
            return {
              ...fileData,
              id: fileData.id || `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            };
          });
          setAudioFiles(reconstructedAudioFiles);
        }

        // Load other settings
        const savedResolution = localStorage.getItem('ffmpeg_resolution');
        if (savedResolution) setResolution(savedResolution);

        const savedTemplate = localStorage.getItem('ffmpeg_template');
        if (savedTemplate) setSelectedTemplate(savedTemplate);

        const savedImageRowSelection = JSON.parse(localStorage.getItem('ffmpeg_imageRowSelection') || '{}');
        setImageRowSelection(savedImageRowSelection);

        const savedSelectedAudioFiles = JSON.parse(localStorage.getItem('ffmpeg_selectedAudioFiles') || '{}');
        setSelectedAudioFiles(savedSelectedAudioFiles);

        const savedDurations = JSON.parse(localStorage.getItem('ffmpeg_durations') || '[]');
        if (savedDurations.length > 0) {
          setDurations(savedDurations);
          const totalDuration = savedDurations.reduce((acc, curr) => acc + curr, 0);
          setDuration(totalDuration);
          setAllDurationsCalculated(true);
        }
      } catch (error) {
        console.error('Error loading saved data:', error);
      }
    };

    loadSavedData();
  }, []);

  // Save data to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('ffmpeg_imageFiles', JSON.stringify(imageFiles));
      localStorage.setItem('ffmpeg_imageBase64Map', JSON.stringify(imageBase64Map));
    } catch (error) {
      console.error('Error saving image files:', error);
    }
  }, [imageFiles, imageBase64Map]);

  useEffect(() => {
    try {
      localStorage.setItem('ffmpeg_audioFiles', JSON.stringify(audioFiles));
    } catch (error) {
      console.error('Error saving audio files:', error);
    }
  }, [audioFiles]);

  useEffect(() => {
    localStorage.setItem('ffmpeg_resolution', resolution);
  }, [resolution]);

  useEffect(() => {
    localStorage.setItem('ffmpeg_template', selectedTemplate);
  }, [selectedTemplate]);

  useEffect(() => {
    localStorage.setItem('ffmpeg_imageRowSelection', JSON.stringify(imageRowSelection));
  }, [imageRowSelection]);

  useEffect(() => {
    localStorage.setItem('ffmpeg_selectedAudioFiles', JSON.stringify(selectedAudioFiles));
  }, [selectedAudioFiles]);

  useEffect(() => {
    localStorage.setItem('ffmpeg_durations', JSON.stringify(durations));
  }, [durations]);

  useEffect(() => {
    printSelectionStatus(); // Call the method whenever selectedAudioFiles or imageRowSelection changes

    const selectedAudios = audioFiles.filter(file => selectedAudioFiles[file.id]);
    const selectedImages = imageFiles.filter(file => imageRowSelection[file.id]);

    if (selectedAudios.length > 0 && selectedImages.length > 0) {
      console.log("enable render");
      setRenderButtonEnabled(true);
    } else {
      setRenderButtonEnabled(false);
    }
  }, [selectedAudioFiles, imageRowSelection]);

  const processFiles = async (files) => {
    const audio = files.filter(file => {
      const ext = file.name.split('.').pop().toLowerCase();
      return audioExtensions.includes(ext);
    });
  
    const images = files.filter(file => {
      const ext = file.name.split('.').pop().toLowerCase();
      return imageExtensions.includes(ext);
    });
  
    if (files.length !== (audio.length + images.length)) {
      setMessage('Warning: Some files were skipped due to unsupported format.');
    }
  
    // Handle image files
    const updatedImageFiles = await Promise.all(images.map(async file => {
      const existingFile = imageFiles.find(existing => 
        existing.name === file.name && existing.size === file.size
      );
      if (existingFile) return null;

      const base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const binaryData = e.target.result;
          const base64String = btoa(
            new Uint8Array(binaryData)
              .reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          resolve(base64String);
        };
        reader.readAsArrayBuffer(file);
      });

      const id = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setImageBase64Map(prev => ({
        ...prev,
        [id]: base64Data
      }));

      return {
        ...file,
        id,
        name: file.name,
        size: file.size
      };
    }));

    const filteredNewImageFiles = updatedImageFiles.filter(file => file !== null);
    setImageFiles(prevFiles => [...prevFiles, ...filteredNewImageFiles]);

    // Handle audio files
    const updatedAudioFiles = await Promise.all(audio.map(async file => {
      const existingFile = audioFiles.find(existing => 
        existing.name === file.name && existing.size === file.size
      );
      if (existingFile) return null;

      // Create a proper File object if it isn't one already
      const audioFile = file instanceof File ? file : new File([file], file.name, { type: file.type });
      
      try {
        // Create an audio element to get duration
        const audioElement = new Audio();
        const objectUrl = URL.createObjectURL(audioFile);
        
        const duration = await new Promise((resolve) => {
          audioElement.addEventListener('loadedmetadata', () => {
            resolve(audioElement.duration);
          });
          audioElement.addEventListener('error', () => {
            resolve(0); // Default to 0 if there's an error
          });
          audioElement.src = objectUrl;
        });

        // Clean up the object URL
        URL.revokeObjectURL(objectUrl);

        return {
          ...audioFile,
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          duration,
          name: audioFile.name,
          size: audioFile.size
        };
      } catch (error) {
        console.error('Error processing audio file:', error);
        return null;
      }
    }));

    const filteredNewAudioFiles = updatedAudioFiles.filter(file => file !== null);
    setAudioFiles(prevFiles => [...prevFiles, ...filteredNewAudioFiles]);

    // Update durations
    const newDurations = filteredNewAudioFiles.map(file => file.duration);
    setDurations(prev => [...prev, ...newDurations]);
    setDuration(prev => prev + newDurations.reduce((acc, curr) => acc + curr, 0));
    
    // Update file size
    const newFilesSize = [...filteredNewImageFiles, ...filteredNewAudioFiles]
      .reduce((acc, file) => acc + file.size, 0);
    setTotalFileSize(prev => {
      const newSize = prev + newFilesSize;
      if (newSize > 4 * 1024 * 1024 * 1024) {
        setMessage('Warning: Total file size exceeds 4GB limit.');
      } else {
        setMessage('Files loaded successfully.');
      }
      return newSize;
    });

    setAllDurationsCalculated(true);
};

  const formatDuration = (seconds) => {
    if (isNaN(seconds)) return 'NaN';
    const totalSeconds = parseFloat(seconds); // Ensure the duration is parsed as a float
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const loadFfmpeg = useCallback(async () => {
    if (!ffmpegLoaded) {
      try {
        setMessage('Loading ffmpeg-core.js');
        await ffmpeg.load();
        setFfmpegLoaded(true);
        setMessage('ffmpeg loaded. Now you can run commands.');
      } catch (err) {
        setMessage('Failed to load ffmpeg');
        console.error(err);
      }
    }
  }, [ffmpeg, ffmpegLoaded]);

  // Remove the auto-loading useEffect and keep the manual load button
  /*
  useEffect(() => {
    loadFfmpeg();
  }, [loadFfmpeg]);
  */

  const handleFfmpegLog = useCallback(({ type, message }) => {
    setFfmpegLogs(prev => [...prev, `[${type}] ${message}`]);
    if (type === 'fferr') {
      const match = message.match(/time=([\d:.]+)/);
      if (match) {
        const elapsed = match[1].split(':').reduce((acc, time) => (60 * acc) + +time, 0);
        const progress = Math.min((elapsed / duration) * 100, 100);
        setProgress(Math.round(progress));
      }
    }
  }, [duration]);

  useEffect(() => {
    if (ffmpeg) {
      ffmpeg.setLogger(handleFfmpegLog);
    }
  }, [ffmpeg, handleFfmpegLog]);

  const renderVideo = useCallback(async (options) => {
    if (!ffmpegLoaded) {
      setMessage('Please load ffmpeg first.');
      return;
    }
  
    const selectedAudios = audioFiles.filter(file => selectedAudioFiles[file.id]);
    const selectedImages = imageFiles.filter(file => imageRowSelection[file.id]);
    
    if (selectedAudios.length === 0 || selectedImages.length === 0) {
      setMessage('Please select at least one audio and one image file.');
      return;
    }
  
    setRenderClicked(true);
    setIsRendering(true);
    setProgress(0);
    
    try {
      setMessage('Starting render...');
      
      const audioFile = selectedAudios[0];
      const imageFile = selectedImages[0];
      
      console.log("Processing input files:", { audioFile, imageFile });

      // Create object URLs for the files
      let audioObjectUrl, imageObjectUrl;

      try {
        // Handle audio file
        if (audioFile instanceof File) {
          audioObjectUrl = URL.createObjectURL(audioFile);
        } else {
          // Create a new Blob from the audio data if not a File object
          const audioBlob = new Blob([await fetchFile(audioFile.data || audioFile.url)], { type: 'audio/mp3' });
          audioObjectUrl = URL.createObjectURL(audioBlob);
        }

        // Handle image file
        if (imageFile instanceof File) {
          imageObjectUrl = URL.createObjectURL(imageFile);
        } else {
          // Convert base64 to Blob for image file
          const base64Data = imageBase64Map[imageFile.id];
          if (!base64Data) {
            throw new Error('Image data not found');
          }
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });
          imageObjectUrl = URL.createObjectURL(imageBlob);
        }

        // Write files to FFmpeg's virtual filesystem using fetchFile
        ffmpeg.FS('writeFile', 'input.jpg', await fetchFile(imageObjectUrl));
        ffmpeg.FS('writeFile', 'input.mp3', await fetchFile(audioObjectUrl));

        const command = [
          '-loop', '1',
          '-framerate', '2',
          '-i', 'input.jpg',
          '-i', 'input.mp3',
          '-c:v', 'libx264',
          '-preset', 'slow',
          '-tune', 'stillimage',
          '-crf', '18',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          'output.mp4'
        ];

        console.log('Running ffmpeg command:', command.join(' '));
        setFfmpegCommand(command);
        
        await ffmpeg.run(...command);
        setMessage('Render complete');
        
        const data = ffmpeg.FS('readFile', 'output.mp4');
        const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
        setVideoSrc(URL.createObjectURL(videoBlob));
        setOutputFileSize(data.length);

        // Clean up files from virtual filesystem
        ffmpeg.FS('unlink', 'input.jpg');
        ffmpeg.FS('unlink', 'input.mp3');
        ffmpeg.FS('unlink', 'output.mp4');

      } finally {
        // Clean up object URLs
        if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
        if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      }

    } catch (err) {
      if (err.message !== 'AbortError') {
        console.error('Render error:', err);
        setMessage(`Error rendering video: ${err.message}`);
      }
    } finally {
      setIsRendering(false);
    }
  }, [ffmpeg, ffmpegLoaded, audioFiles, imageFiles, selectedAudioFiles, imageRowSelection, imageBase64Map]);

  const stopRendering = useCallback(() => {
    if (ffmpeg && isRendering) {
      try {
        ffmpeg.exit(); // This kills the FFmpeg process
        setMessage('Rendering cancelled');
        setProgress(0);
        setIsRendering(false);
      } catch (err) {
        console.error('Error stopping ffmpeg:', err);
      }
    }
  }, [ffmpeg, isRendering]);

  const downloadVideo = () => {
    const link = document.createElement('a');
    link.href = videoSrc;
    link.download = 'output.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Modify the clearTable function to also clear localStorage
  const clearTable = () => {
    setAudioFiles([]);
    setImageFiles([]);
    setSelectedAudioFiles([]);
    setSelectedImageFiles([]);
    setDurations([]);
    setDuration(0);
    setAllDurationsCalculated(false);
    setImageBase64Map({});
    
    // Clear localStorage items
    localStorage.removeItem('ffmpeg_imageFiles');
    localStorage.removeItem('ffmpeg_imageBase64Map');
    localStorage.removeItem('ffmpeg_audioFiles');
    localStorage.removeItem('ffmpeg_imageRowSelection');
    localStorage.removeItem('ffmpeg_selectedAudioFiles');
    localStorage.removeItem('ffmpeg_durations');
  };

  const getSelectedAudioRows = () => {
    const selectedRows = audioFiles.filter(file => selectedAudioFiles[file.id]);
    console.log('Selected audio rows:', selectedRows);
  };

  const handleRenderOptions = (options) => {
    setResolution(options.resolution);
    // Implement other option handling as needed
  };

  // Template-specific layouts
  const renderTemplateContent = () => {
    switch (selectedTemplate) {
      case 'combine':
        return (
          <>
            <input type="file" multiple onChange={handleFileChange} ref={fileInputRef} style={{ display: 'none' }} />
            <Table
              data={audioFiles}
              setData={setAudioFiles}
              columns={[
                {
                  accessorKey: 'name',
                  header: 'File Name',
                  // Add a custom cell renderer to handle File objects
                  cell: info => info.row.original instanceof File ? info.row.original.name : info.getValue()
                },
                { accessorKey: 'size', header: 'Size (MB)', cell: info => (info.getValue() / (1024 * 1024)).toFixed(2) },
                {
                  accessorKey: 'duration',
                  header: 'Duration',
                  cell: info => formatDuration(info.getValue())
                }
              ]}
              rowSelection={selectedAudioFiles}
              setRowSelection={setSelectedAudioFiles}
              title="Audio Files"
              isAudioTable={true}
              globalFilter={globalFilter}
              setGlobalFilter={setGlobalFilter}
              setMessage={setMessage}
              setTotalFileSize={setTotalFileSize}
              setDurations={setDurations}
              setDuration={setDuration}
              setAllDurationsCalculated={setAllDurationsCalculated}
              emptyTableText="0 Audio Files added" // Pass the new prop
              setRenderButtonEnabled={setRenderButtonEnabled} // Pass the state setter as a prop
            />
            <Table
              title="Image Files"
              data={imageFiles}
              rowSelection={imageRowSelection}
              setRowSelection={setImageRowSelection}
              setData={setImageFiles}
              columns={imageColumns}
              isImageTable={true}
              setImageFiles={setImageFiles}
              globalFilter={globalFilter}
              setGlobalFilter={setGlobalFilter}
              setMessage={setMessage}
              setTotalFileSize={setTotalFileSize}
              setDurations={() => { }}
              setDuration={() => { }}
              setAllDurationsCalculated={() => { }}
              emptyTableText="0 Image Files added" // Pass the new prop
              setRenderButtonEnabled={setRenderButtonEnabled} // Pass the state setter as a prop
            />
            <RenderOptions 
              imageFiles={imageFiles}
              audioFiles={audioFiles}
              audioRowSelection={selectedAudioFiles}
              imageRowSelection={selectedImageFiles}
              onRender={renderVideo} // Call renderVideo method
              resolution={resolution}
              setResolution={setResolution}
              renderButtonEnabled={renderButtonEnabled} // Pass the state as a prop
            />

            <div>
              <h3>FFmpeg Command</h3>
              <pre>
                {ffmpegCommand.map((arg, index) => (
                  <div key={index}>{arg}</div>
                ))}
              </pre>
            </div>
          </>
        );

      case 'splitSilence':
        return (
          <div className={styles.templateContent}>
            <h2>Split By Silence</h2>
            <p>Template coming soon...</p>
          </div>
        );

      case 'custom':
        return (
          <div className={styles.templateContent}>
            <h2>Custom FFmpeg Command</h2>
            <p>Template coming soon...</p>
          </div>
        );

      default:
        return null;
    }
  };

  const renderSelectedRows = () => {
    const selectedAudios = audioFiles.filter(file => selectedAudioFiles[file.id]);
    const selectedImages = imageFiles.filter(file => imageRowSelection[file.id]);

    return (
      <div className={styles.selectedRowsSection}>
        <h3>Selected Rows</h3>
        <div className={styles.selectedRowsContainer}>
          <div className={styles.selectedRowsColumn}>
            <h4>Selected Audio Files</h4>
            {selectedAudios.length > 0 ? (
              <ul>
                {selectedAudios.map(file => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            ) : (
              <p>No audio files selected.</p>
            )}
          </div>
          <div className={styles.selectedRowsColumn}>
            <h4>Selected Image Files</h4>
            {selectedImages.length > 0 ? (
              <ul>
                {selectedImages.map(file => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            ) : (
              <p>No image files selected.</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.App} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <input type="file" multiple onChange={handleFileChange} ref={fileInputRef} style={{ display: 'none' }} />
      <div className={styles.dropZone} onClick={handleClick}>Click to select or drag and drop files here</div>
      <div className={styles.row}>
        <div className={`${styles.ffmpegSection} ${styles.equalHeight}`}>
          <div className={styles.ffmpegHeader}>
            <h2 className={styles.sectionTitle}>FFmpeg</h2>
            <hr className={styles.headerLine} />
          </div>
          <div className={styles.ffmpegControls}>
            <button onClick={() => setShowLogs(!showLogs)} className={styles.viewLogsButton}>
              {showLogs ? 'Hide Logs ▼' : 'View Logs ▶'}
            </button>
            <button onClick={loadFfmpeg} disabled={ffmpegLoaded} className={styles.loadButton}>
              Load FFmpeg
            </button>
          </div>
          <p className={styles.ffmpegMessage}>{message}</p>
          {showLogs && (
            <div className={styles.logsContainer}>
              {ffmpegLogs.length > 0 ? (
                ffmpegLogs.map((log, index) => (
                  <div key={index} className={styles.logLine}>{log}</div>
                ))
              ) : (
                <div className={styles.emptyLogs}>Click the 'Load FFmpeg' button</div>
              )}
            </div>
          )}
        </div>

        <div className={`${styles.outputSection} ${styles.equalHeight}`}>
          <h2 className={styles.sectionTitle}>Output</h2>
          <hr className={styles.headerLine} />
          <div className={styles.videoWrapper}>
            <video src={videoSrc} controls className={styles.videoBox}></video>
            {progress > 0 && progress < 100 && (
              <div className={styles.progressSection}>
                <div className={styles.progressBar}>
                  <div 
                    className={styles.progressFill} 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className={styles.progressText}>{progress}% Complete</p>
                {isRendering && (
                  <button 
                    onClick={stopRendering} 
                    className={styles.stopButton}
                  >
                    Stop Rendering
                  </button>
                )}
              </div>
            )}
            <div className={styles.outputControls}>
              <p>Output Video File Size: {(outputFileSize / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
            <button 
              onClick={downloadVideo} 
              disabled={!videoSrc} 
              className={styles.downloadButton}
            >
              Download Video
            </button>
          </div>
        </div>
      </div>

      <TemplateSelector 
        selectedTemplate={selectedTemplate}
        onTemplateChange={setSelectedTemplate}
      />
      {renderTemplateContent()}

      {modalImage && (
        <ImageModal 
          imageUrl={`data:image/jpeg;base64,${modalImage.data}`}
          onClose={() => setModalImage(null)}
        />
      )}
      {renderSelectedRows()}
    </div>
  );
}

export default Ffmpegwasm;
