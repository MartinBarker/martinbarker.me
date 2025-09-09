"use client";
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import styles from "./ffmpegwasm.module.css";

function CombineImageAudioExample() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [audioFiles, setAudioFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [message, setMessage] = useState("Select files and click Render Video");
  const [progress, setProgress] = useState(null);
  const [showCommand, setShowCommand] = useState(false);
  const [ffmpegCommand, setFfmpegCommand] = useState([
    "-loop", "1",
    "-framerate", "2",
    "-i", "image.jpg",
    "-i", "audio.mp3",
    "-c:v", "libx264",
    "-preset", "slow",
    "-tune", "stillimage",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "output.mp4"
  ]);
  const ffmpegRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    const newAudioFiles = files.filter((file) => file.type.startsWith("audio/"));
    const newImageFiles = files.filter((file) => file.type.startsWith("image/"));
    setAudioFiles(newAudioFiles);
    setImageFiles(newImageFiles);
    
    // Auto-select first files if available
    if (newAudioFiles.length > 0 && !selectedAudio) {
      setSelectedAudio(newAudioFiles[0]);
    }
    if (newImageFiles.length > 0 && !selectedImage) {
      setSelectedImage(newImageFiles[0]);
    }
  };

  const load = async () => {
    setMessage("Loading ffmpeg-core.js");
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => {
      console.log(message);
    });
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(progress);
      console.log(`Progress: ${(progress * 100).toFixed(1)}%`);
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    setLoaded(true);
    setMessage("Ready to render video");
  };

  const renderVideo = async () => {
    if (!loaded) {
      setMessage("Please load ffmpeg-core first.");
      return;
    }
    if (!selectedAudio || !selectedImage) {
      setMessage("Please select one audio and one image file.");
      return;
    }
    setMessage("Rendering video...");
    setProgress(null);
    const ffmpeg = ffmpegRef.current;
    
    // Write files to ffmpeg FS
    await ffmpeg.writeFile("audio.mp3", await fetchFile(selectedAudio));
    await ffmpeg.writeFile("image.jpg", await fetchFile(selectedImage));
    
    // Run ffmpeg command
    await ffmpeg.exec(ffmpegCommand);
    const data = await ffmpeg.readFile("output.mp4");
    setVideoSrc(URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" })));
    setMessage("Complete rendering video");
    setProgress(null);
  };

  const updateCommandOption = (index, value) => {
    const newCommand = [...ffmpegCommand];
    newCommand[index] = value;
    setFfmpegCommand(newCommand);
  };

  if (!mounted) return null;

  return (
    <section className={styles["ffmpeg-section"]}>
      <h2>Combine Uploaded Image and Audio into a Video</h2>
      
      <div className={styles["file-upload-section"]}>
        <input 
          type="file" 
          multiple 
          onChange={handleFileChange}
          accept="audio/*,image/*"
          className={styles["file-input"]}
        />
      </div>

      <div className={styles["files-display"]}>
        <div className={styles["file-table-container"]}>
          <h4>Audio Files</h4>
          <table className={styles["file-table"]}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {audioFiles.map((file, idx) => (
                <tr key={idx} className={selectedAudio === file ? styles.selected : ''}>
                  <td>
                    <input
                      type="radio"
                      name="audioFile"
                      checked={selectedAudio === file}
                      onChange={() => setSelectedAudio(file)}
                    />
                  </td>
                  <td>{file.name}</td>
                  <td>{(file.size / 1024 / 1024).toFixed(2)} MB</td>
                  <td>{file.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles["file-table-container"]}>
          <h4>Image Files</h4>
          <table className={styles["file-table"]}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {imageFiles.map((file, idx) => (
                <tr key={idx} className={selectedImage === file ? styles.selected : ''}>
                  <td>
                    <input
                      type="radio"
                      name="imageFile"
                      checked={selectedImage === file}
                      onChange={() => setSelectedImage(file)}
                    />
                  </td>
                  <td>{file.name}</td>
                  <td>{(file.size / 1024 / 1024).toFixed(2)} MB</td>
                  <td>{file.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles["command-section"]}>
        <button 
          className={styles["toggle-command-btn"]}
          onClick={() => setShowCommand(!showCommand)}
        >
          {showCommand ? 'Hide' : 'Show'} FFmpeg Command
        </button>
        
        {showCommand && (
          <div className={styles["command-editor"]}>
            <h4>FFmpeg Command Options</h4>
            <p className={styles["command-info"]}>
              Edit the FFmpeg command options below. The command will be executed as:
            </p>
            <div className={styles["command-preview"]}>
              <code>ffmpeg {ffmpegCommand.join(' ')}</code>
            </div>
            
            <div className={styles["command-options"]}>
              {ffmpegCommand.map((option, index) => (
                <div key={index} className={styles["command-option"]}>
                  <label>Option {index}:</label>
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => updateCommandOption(index, e.target.value)}
                    className={styles["command-input"]}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {videoSrc && (
        <div className={styles["video-output"]}>
          <h4>Generated Video</h4>
          <video src={videoSrc} controls style={{ maxWidth: "100%" }} />
        </div>
      )}

      <div className={styles["action-section"]}>
        {!loaded ? (
          <button onClick={load} className={styles["load-btn"]}>Load ffmpeg-core (~31 MB)</button>
        ) : (
          <button 
            onClick={renderVideo} 
            className={styles["render-btn"]}
            disabled={!selectedAudio || !selectedImage}
          >
            Render Video
          </button>
        )}
        <p className={styles.message}>{message}</p>
        {progress !== null && (
          <div className={styles["progress-bar"]}>
            <div 
              className={styles["progress-fill"]} 
              style={{ width: `${(progress * 100)}%` }}
            ></div>
            <span className={styles["progress-text"]}>{(progress * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className={styles["ffmpeg-main"]}>
      {/* FFMPEG WASM Info Section */}
      <div style={{
        background: '#f5f7fa',
        border: '1px solid #e3e8ee',
        borderRadius: 8,
        padding: '24px 20px',
        marginBottom: 32,
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <p style={{ fontSize: 17, marginBottom: 8 }}>
          <strong>FFMPEG WASM</strong> is a browser-based video and audio processing tool using FFmpeg WebAssembly for client-side media manipulation.
        </p>
        <ul style={{ fontSize: 16, marginBottom: 8, paddingLeft: 22 }}>
          <li>Process video and audio files directly in your browser without server uploads.</li>
          <li>Combine images and audio files into video content using WebAssembly technology.</li>
          <li>Convert between different media formats and apply various filters and effects.</li>
          <li>Experience high-performance media processing with complete privacy and security.</li>
        </ul>
      </div>



      <CombineImageAudioExample />
    </main>
  );
}
