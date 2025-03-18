import React, { useState } from 'react';
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';
import styles from './Ffmpegwasm.module.css'; // Import the CSS module

// Polyfill for SharedArrayBuffer
if (typeof SharedArrayBuffer === 'undefined') {
  window.SharedArrayBuffer = ArrayBuffer;
}

function Ffmpegwasm() {
  const [videoSrc, setVideoSrc] = useState('');
  const [message, setMessage] = useState('Click Load to load ffmpeg');
  const [audioFiles, setAudioFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const ffmpeg = React.useMemo(() => createFFmpeg({ log: true }), []);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    const audio = files.filter(file => file.type.startsWith('audio/'));
    const images = files.filter(file => file.type.startsWith('image/'));
    setAudioFiles(audio);
    setImageFiles(images);
  };

  const loadFfmpeg = React.useCallback(async () => {
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

const renderVideo = React.useCallback(async () => {
  if (!ffmpegLoaded) {
      setMessage('Please load ffmpeg first.');
      return;
  }

  if (audioFiles.length === 0 || imageFiles.length === 0) {
      setMessage('Please select at least one audio and one image file.');
      return;
  }

  try {
      setMessage('Start rendering video');
      const audioFile = audioFiles[0];
      const imageFile = imageFiles[0];

      ffmpeg.FS('writeFile', 'audio.mp3', await fetchFile(URL.createObjectURL(audioFile)));
      ffmpeg.FS('writeFile', 'image.jpg', await fetchFile(URL.createObjectURL(imageFile)));

      const command = ['-loop', '1', '-framerate', '2', '-i', 'image.jpg', '-i', 'audio.mp3', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'stillimage', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-shortest', 'output.mp4'];
      console.log('Running ffmpeg command:', command.join(' '));

      await ffmpeg.run(...command);

      setMessage('Complete rendering video');
      const data = ffmpeg.FS('readFile', 'output.mp4');
      setVideoSrc(URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' })));
  } catch (err) {
      setMessage('Error rendering video');
      console.error(err);
  }
}, [ffmpeg, ffmpegLoaded, audioFiles, imageFiles]);


  return (
    <div className={styles.App}> {/* Apply the CSS module styles */}
      <header className={styles.AppHeader}> {/* Apply the CSS module styles */}
        <h1>FFmpeg.wasm Test Page</h1>
        <p>This is a test page for <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer">ffmpeg.wasm</a>.</p>
        <p>FFmpeg.wasm is a WebAssembly port of FFmpeg, which allows you to run FFmpeg directly in the browser.</p>
        <p>This site allows you to render videos using audio and image files.</p>
        <p>Created by Martin Barker. This site is a work in progress.</p>
      </header>
      <input type="file" multiple onChange={handleFileChange} />
      <div>
        <h3>Audio Files</h3>
        <table>
          <tbody>
            {audioFiles.map((file, index) => (
              <tr key={index}>
                <td>{file.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Image Files</h3>
        <table>
          <tbody>
            {imageFiles.map((file, index) => (
              <tr key={index}>
                <td>{file.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <video src={videoSrc} controls></video><br/>
      <button onClick={loadFfmpeg} disabled={ffmpegLoaded}>Load ffmpeg</button>
      <button onClick={renderVideo}>Render Video</button>
      <p>{message}</p>
    </div>
  );
}

export default Ffmpegwasm;
