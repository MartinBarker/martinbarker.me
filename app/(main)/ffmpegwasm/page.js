"use client";
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

function CombineImageAudioExample() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [audioFiles, setAudioFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [videoSrc, setVideoSrc] = useState("");
  const [message, setMessage] = useState("Select files and click Render Video");
  const [progress, setProgress] = useState(null);
  const ffmpegRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    setAudioFiles(files.filter((file) => file.type.startsWith("audio/")));
    setImageFiles(files.filter((file) => file.type.startsWith("image/")));
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
    if (audioFiles.length === 0 || imageFiles.length === 0) {
      setMessage("Please select at least one audio and one image file.");
      return;
    }
    setMessage("Rendering video...");
    setProgress(null);
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => {
      console.log(message);
    });
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(progress);
      console.log(`Progress: ${(progress * 100).toFixed(1)}%`);
    });
    // Write files to ffmpeg FS
    await ffmpeg.writeFile("audio.mp3", await fetchFile(audioFiles[0]));
    await ffmpeg.writeFile("image.jpg", await fetchFile(imageFiles[0]));
    // Run ffmpeg command
    await ffmpeg.exec([
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
    const data = await ffmpeg.readFile("output.mp4");
    setVideoSrc(URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" })));
    setMessage("Complete rendering video");
    setProgress(null);
  };

  if (!mounted) return null;

  return (
    <section style={{ marginTop: "2em", padding: "1em", border: "1px solid #eee" }}>
      <h2>Combine Uploaded Image and Audio into a Video</h2>
      <input type="file" multiple onChange={handleFileChange} />
      <div>
        <h4>Audio Files</h4>
        <ul>
          {audioFiles.map((file, idx) => <li key={idx}>{file.name}</li>)}
        </ul>
      </div>
      <div>
        <h4>Image Files</h4>
        <ul>
          {imageFiles.map((file, idx) => <li key={idx}>{file.name}</li>)}
        </ul>
      </div>
      {videoSrc && (
        <video src={videoSrc} controls style={{ maxWidth: "100%" }} />
      )}
      <br />
      {!loaded ? (
        <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
      ) : (
        <button onClick={renderVideo}>Render Video</button>
      )}
      <p>{message}</p>
      {progress !== null && (
        <p>Progress: {(progress * 100).toFixed(1)}%</p>
      )}
    </section>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ffmpegRef = useRef(null);
  const videoRef = useRef(null);
  const messageRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  const load = async () => {
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
      console.log(message);
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    setLoaded(true);
  };

  const transcode = async () => {
    const ffmpeg = ffmpegRef.current;
    await ffmpeg.writeFile(
      "input.webm",
      await fetchFile(
        "https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm"
      )
    );
    await ffmpeg.exec(["-i", "input.webm", "output.mp4"]);
    const data = await ffmpeg.readFile("output.mp4");
    if (videoRef.current) {
      videoRef.current.src = URL.createObjectURL(
        new Blob([data.buffer], { type: "video/mp4" })
      );
    }
  };

  if (!mounted) return null;

  return (
    <main>
      <section style={{ marginBottom: "2em", padding: "1em", border: "1px solid #eee" }}>
        <h2>Transcode webm to mp4</h2>
        {loaded ? (
          <>
            {/* Only render video if src is set */}
            <video ref={videoRef} controls style={{ maxWidth: "100%" }} />
            <br />
            <button onClick={transcode}>Transcode webm to mp4</button>
            <p ref={messageRef}></p>
            <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
          </>
        ) : (
          <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )}
      </section>
      <CombineImageAudioExample />
    </main>
  );
}
