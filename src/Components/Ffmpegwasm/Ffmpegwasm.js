import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';
import styles from './Ffmpegwasm.module.css'; // Import the CSS module
import Table from "../Table/Table.js";

// Polyfill for SharedArrayBuffer
if (typeof SharedArrayBuffer === 'undefined') {
  window.SharedArrayBuffer = ArrayBuffer;
}

function Ffmpegwasm() {
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

  const imageColumns = [
    {
      accessorKey: 'thumbnail',
      header: 'Thumbnail',
      cell: ({ row }) => <Thumbnail src={row.original} />
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

    // Keep the original File objects
    const updatedImageFiles = images.map(file => ({
      ...file,
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
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
            setMessage('ffmpeg loaded. Now you can render the video.');
        } catch (err) {
            setMessage('Failed to load ffmpeg');
            console.error(err);
        }
    }
}, [ffmpeg, ffmpegLoaded]);

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

  return (
    <div className={styles.App} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}> {/* Apply the CSS module styles */}
      <header className={styles.AppHeader}> {/* Apply the CSS module styles */}
        <p>
          This is a test page for <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer">ffmpeg.wasm</a>. 
          FFmpeg.wasm is a WebAssembly port of FFmpeg, which allows you to run FFmpeg directly in the browser. 
          This site allows you to render videos using audio and image files. 
          Created by Martin Barker. This site is a work in progress.
        </p>
      </header>
      <input type="file" multiple onChange={handleFileChange} ref={fileInputRef} style={{ display: 'none' }} />
      <div className={styles.dropZone} onClick={handleClick}>Click to select or drag and drop files here</div>
      
      {/* Update the button to use the specific class 
      <button onClick={getSelectedAudioRows} className={styles.getSelectedButton}>
        Get Selected Audio Rows
      </button> */}
      
      <div>
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
        />
      </div>
      <div>
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
          // Add empty function props to avoid undefined errors
          setMessage={setMessage}
          setTotalFileSize={setTotalFileSize}
          setDurations={() => {}}
          setDuration={() => {}}
          setAllDurationsCalculated={() => {}}
        />
      </div>
      <div>
        <label htmlFor="resolution">Output Resolution:</label>
        <input type="text" id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </div>
      <div>
        <p>Total File Size: {(totalFileSize / (1024 * 1024)).toFixed(2)} MB</p>
      </div>
      <video src={videoSrc} controls className={styles.videoBox}></video><br/>
      <div>
        <p>Output Video File Size: {(outputFileSize / (1024 * 1024)).toFixed(2)} MB</p>
      </div>
      <button onClick={loadFfmpeg} disabled={ffmpegLoaded}>Load ffmpeg</button>
      <button onClick={renderVideo} disabled={!ffmpegLoaded || !allDurationsCalculated || selectedAudioFiles.length === 0 || selectedImageFiles.length === 0}>
        {allDurationsCalculated ? 'Render Video' : 'Wait for all audio file lengths to be calculated'}
      </button>
      <div style={{ visibility: progress === 0 && !renderClicked ? 'hidden' : 'visible' }}>
        <h3>Render Progress</h3>
        <p>{progress}%</p>
      </div>
      <button onClick={downloadVideo} disabled={!videoSrc}>Download Video</button>
      <button onClick={clearTable}>Clear Table</button>
      <p>{message}</p>
      <div>
        <h3>FFmpeg Command</h3>
        <pre>
          {ffmpegCommand.map((arg, index) => (
            <div key={index}>{arg}</div>
          ))}
        </pre>
      </div>
      
      {/* Display selected images */}
      {imageFiles.length > 0 && (
        <div className={styles.selectedImagesContainer}>
          <h3>Selected Images</h3>
          <div className={styles.imageGrid}>
            {imageFiles.map((file, index) => (
              <div key={index} className={styles.imageWrapper}>
                {file instanceof File && (
                  <FilePreview 
                    file={file} 
                    index={index}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Add this new component inside Ffmpegwasm component
const FilePreview = ({ file, index }) => {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target.result);
    };
    reader.readAsDataURL(file);

    return () => {
      reader.abort();
    };
  }, [file]);

  if (!previewUrl) {
    return null;
  }

  return (
    <>
      <img
        src={previewUrl}
        alt={`Selected ${index + 1}`}
        className={styles.previewImage}
      />
      <p className={styles.imageName}>{file.name}</p>
    </>
  );
};

export default Ffmpegwasm;
