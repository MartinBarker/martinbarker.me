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
      cell: ({ row }) => row.original.name
    },
    {
      accessorKey: 'size',
      header: 'Size (MB)',
      cell: ({ row }) => (row.original.size / (1024 * 1024)).toFixed(2)
    },
  ];

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    processFiles(files);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    processFiles(files);
  };

  const handleClick = () => {
    fileInputRef.current.click();
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
      }
      setSelectedImageFiles(newSelectedImageFiles);
    }
  };

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
  
    // Keep the original File objects and generate base64 data
    const updatedImageFiles = await Promise.all(images.map(async file => {
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
      
      // Update the base64 map
      setImageBase64Map(prev => ({
        ...prev,
        [id]: base64Data
      }));

      return {
        ...file,
        id
      };
    }));
    const updatedAudioFiles = audio.map(file => ({
      ...file,
      size: file.size,
      name: file.name,
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }));
  
    setAudioFiles(updatedAudioFiles);
    setImageFiles(updatedImageFiles);
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    setTotalFileSize(totalSize);
    if (totalSize > 4 * 1024 * 1024 * 1024) {
      setMessage('Warning: Total file size exceeds 4GB limit.');
    } else {
      setMessage('Files loaded successfully.');
    }
  
    let totalDuration = 0;
    const fileDurations = [];
    const processedAudioFiles = [...updatedAudioFiles];
  
    for (const [index, file] of audio.entries()) {
      const audioData = await fetchFile(URL.createObjectURL(file));
      const audioBlob = new Blob([audioData], { type: file.type });
      const audioElement = new Audio(URL.createObjectURL(audioBlob));
      await new Promise((resolve) => {
        audioElement.addEventListener('loadedmetadata', () => {
          const fileDuration = audioElement.duration;
          console.log(`Duration of ${file.name}: ${fileDuration} seconds`);
          totalDuration += fileDuration;
          fileDurations[index] = fileDuration;
          processedAudioFiles[index] = { 
            ...processedAudioFiles[index], // Keep the ID we generated
            duration: fileDuration,
            size: file.size 
          };
          resolve();
        });
      });
    }
    
    setAudioFiles(processedAudioFiles);
    setDurations(fileDurations);
    setDuration(totalDuration);
    setAllDurationsCalculated(true);
    console.log(`Total duration: ${totalDuration} seconds`);
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

  const renderVideo = useCallback(async () => {
    if (!ffmpegLoaded) {
      setMessage('Please load ffmpeg first.');
      return;
    }

    if (selectedAudioFiles.length === 0 || selectedImageFiles.length === 0) {
      setMessage('Please select at least one audio and one image file.');
      return;
    }

    setRenderClicked(true);

    try {
      setMessage('Start rendering video');
      const selectedImages = selectedImageFiles.map(index => imageFiles[index]);
      const selectedAudios = selectedAudioFiles.map(index => audioFiles[index]);

      const audioInputs = [];
      const audioFilters = [];
      for (let index = 0; index < selectedAudios.length; index++) {
        const file = selectedAudios[index];
        const audioFileName = `audio${index}.mp3`;
        audioInputs.push('-ss', '0', '-to', durations[selectedAudioFiles[index]].toFixed(2), '-i', audioFileName);
        audioFilters.push(`[${index}:a]`);
        await ffmpeg.FS('writeFile', audioFileName, await fetchFile(URL.createObjectURL(file)));
      }

      const imageInputs = [];
      for (let index = 0; index < selectedImages.length; index++) {
        const file = selectedImages[index];
        const imageFileName = `image${index}.jpg`;
        imageInputs.push('-r', '2', '-i', imageFileName);
        await ffmpeg.FS('writeFile', imageFileName, await fetchFile(URL.createObjectURL(file)));
      }

      const filterComplex = `${audioFilters.join('')}concat=n=${selectedAudios.length}:v=0:a=1[a];${selectedImages.map((_, index) => `[${selectedAudios.length + index}:v]scale=w=640:h=640:force_original_aspect_ratio=increase,boxblur=20:20,crop=640:640:(iw-640)/2:(ih-640)/2,setsar=1[bg${index}];[${selectedAudios.length + index}:v]scale=w=640:h=640:force_original_aspect_ratio=decrease,setsar=1,loop=6216:6216[fg${index}];[bg${index}][fg${index}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1,loop=6216:6216[v${index}];`).join('')}${selectedImages.map((_, index) => `[v${index}]`).join('')}concat=n=${selectedImages.length}:v=1:a=0,pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`;

      const command = ['-y', ...audioInputs, ...imageInputs, '-filter_complex', filterComplex, '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '320k', '-c:v', 'h264', '-movflags', '+faststart', '-profile:v', 'high', '-level:v', '4.2', '-bufsize', '3M', '-crf', '18', '-pix_fmt', 'yuv420p', '-tune', 'stillimage', '-t', duration.toFixed(2), 'output.mp4'];
      setFfmpegCommand(command);
      console.log('Running ffmpeg command:', command.join(' '));

      ffmpeg.setLogger(({ type, message }) => {
        if (type === 'fferr') {
          const match = message.match(/time=([\d:.]+)/);
          if (match) {
            const elapsed = match[1].split(':').reduce((acc, time) => (60 * acc) + +time, 0);
            const progress = Math.min((elapsed / duration) * 100, 100);
            setProgress(Math.round(progress));
          }
        }
      });

      await ffmpeg.run(...command);

      setMessage('Complete rendering video');
      const data = ffmpeg.FS('readFile', 'output.mp4');
      setOutputFileSize(data.length);
      setVideoSrc(URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' })));
    } catch (err) {
      setMessage('Error rendering video');
      console.error(err);
    }
  }, [ffmpeg, ffmpegLoaded, audioFiles, imageFiles, resolution, duration, durations, selectedAudioFiles, selectedImageFiles]);

  const downloadVideo = () => {
    const link = document.createElement('a');
    link.href = videoSrc;
    link.download = 'output.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearTable = () => {
    setAudioFiles([]);
    setImageFiles([]);
    setSelectedAudioFiles([]);
    setSelectedImageFiles([]);
    setDurations([]);  // Also clear durations
    setDuration(0);    // Reset total duration
    setAllDurationsCalculated(false);  // Reset duration calculation flag
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
            <div className={styles.dropZone} onClick={handleClick}>Click to select or drag and drop files here</div>
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
            />
            <RenderOptions 
              imageFiles={imageFiles}
              audioFiles={audioFiles}
              audioRowSelection={selectedAudioFiles}
              imageRowSelection={selectedImageFiles}
              onRender={handleRenderOptions}
              resolution={resolution}
              setResolution={setResolution}
            />
            <div>
              <h3>Render Progress</h3>
              <p>{progress}%</p>
            </div>
            <div>
              <p>Output Video File Size: {(outputFileSize / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
            <button onClick={renderVideo} disabled={!ffmpegLoaded || selectedAudioFiles.length === 0 || selectedImageFiles.length === 0}>
              {allDurationsCalculated ? 'Render Video' : 'Audio file lengths still calculating in background...'}
            </button>
            <button onClick={downloadVideo} disabled={!videoSrc}>Download Video</button>
            <button onClick={clearTable}>Clear Table</button>
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

  return (
    <div className={styles.App} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
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
            <div className={styles.outputControls}>
              <p>Output Video File Size: {(outputFileSize / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
          </div>
        </div>
      </div>

      <TemplateSelector 
        selectedTemplate={selectedTemplate}
        onTemplateChange={setSelectedTemplate}
      />
      {renderTemplateContent()}

      <div className={styles.outputSection}>
        <h2 className={styles.sectionTitle}>Output:</h2>
        <div className={styles.videoWrapper}>
          <div className={styles.buttonGroup}>
            <button onClick={downloadVideo} disabled={!videoSrc}>Download Video</button>
            <button onClick={clearTable}>Clear Table</button>
          </div>
        </div>
      </div>

      {modalImage && (
        <ImageModal 
          imageUrl={`data:image/jpeg;base64,${modalImage.data}`}
          onClose={() => setModalImage(null)}
        />
      )}
    </div>
  );
}

export default Ffmpegwasm;
