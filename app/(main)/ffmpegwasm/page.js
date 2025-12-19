"use client";
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import styles from "./ffmpegwasm.module.css";
import Table from "./Table";

// Adapted FFmpeg command builder based on provided FFmpegUtils
const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return "Loading...";
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

function createFFmpegCommand(configs) {
  try {
    const {
      audioInputs = [],
      imageInputs = [],
      outputFilepath,
      width = 2000,
      height = 2000,
      paddingCheckbox = false,
      backgroundColor = "black",
      repeatLoop = true,
      totalDurationOverride = null,
    } = configs;

    const cmdArgs = ["-y"];

    let outputDuration =
      totalDurationOverride !== null
        ? totalDurationOverride
        : audioInputs.reduce((acc, audio) => acc + (audio.duration || 0), 0);

    const imgDuration = (outputDuration || 1) / (imageInputs.length || 1);

    audioInputs.forEach((audio) => {
      const startTime = audio.startTime || "00:00";
      const endTime = audio.endTime || audio.duration;
      const startTimeInSeconds = startTime
        .split(":")
        .reduce((acc, time) => 60 * acc + +time, 0);
      const endTimeInSeconds =
        typeof endTime === "string"
          ? endTime.split(":").reduce((acc, time) => 60 * acc + +time, 0)
          : endTime;

      if (audio.startTime !== "" && audio.endTime !== "") {
        cmdArgs.push("-ss", startTimeInSeconds.toString());
        cmdArgs.push("-to", endTimeInSeconds.toString());
      }
      cmdArgs.push("-i", `${audio.filepath.replace(/\\/g, "/")}`);
    });

    imageInputs.forEach((image) => {
      cmdArgs.push("-r", "2");
      cmdArgs.push("-i", `${image.filepath.replace(/\\/g, "/")}`);
    });

    let filterComplexStr = "";
    if (audioInputs.length > 0) {
      filterComplexStr += audioInputs.map((_, index) => `[${index}:a]`).join("");
      filterComplexStr += `concat=n=${audioInputs.length}:v=0:a=1[a];`;
    }

    imageInputs.forEach((image, index) => {
      const imgIndex = audioInputs.length + index;
      if (image.useBlurBackground) {
        const blurBackground = [
          `[${imgIndex}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,boxblur=20:20,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1[bg${index}];`,
          `[${imgIndex}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,setsar=1,loop=${Math.round(imgDuration * 2)}:${Math.round(imgDuration * 2)}[fg${index}];`,
          `[bg${index}][fg${index}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1,loop=${Math.round(imgDuration * 2)}:${Math.round(imgDuration * 2)}[v${index}];`
        ].join("");
        filterComplexStr += blurBackground;
      } else {
        let scaleFilter;
        if (image.stretchImageToFit) {
          scaleFilter = `scale=w=${width}:h=${height}`;
        } else {
          scaleFilter = `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease`;
        }
        const padFilter = image.stretchImageToFit
          ? ""
          : `,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${image.paddingColor || backgroundColor}`;
        filterComplexStr += `[${imgIndex}:v]${scaleFilter}${padFilter},setsar=1,loop=${Math.round(imgDuration * 2)}:${Math.round(imgDuration * 2)}[v${index}];`;
      }
    });

    if (imageInputs.length > 0) {
      const imageRefs = imageInputs.map((_, index) => `[v${index}]`).join("");
      filterComplexStr += `${imageRefs}concat=n=${imageInputs.length}:v=1:a=0,pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`;
    }

    if (filterComplexStr) {
      cmdArgs.push("-filter_complex", filterComplexStr);
      if (imageInputs.length > 0) cmdArgs.push("-map", "[v]");
      if (audioInputs.length > 0) cmdArgs.push("-map", "[a]");
    }

    const isMP4 = outputFilepath.toLowerCase().endsWith(".mp4");
    if (isMP4) {
      cmdArgs.push(
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-c:v",
        "h264",
        "-movflags",
        "+faststart",
        "-profile:v",
        "high",
        "-level:v",
        "4.2"
      );
    } else {
      cmdArgs.push("-c:a", "pcm_s32le", "-c:v", "libx264");
    }

    cmdArgs.push("-bufsize", "3M");
    cmdArgs.push("-crf", "18");
    cmdArgs.push("-pix_fmt", "yuv420p");
    cmdArgs.push("-tune", "stillimage");
    cmdArgs.push("-t", `${outputDuration || 5}`);
    cmdArgs.push(`${outputFilepath}`);

    const commandString = cmdArgs.join(" ");
    return { cmdArgs, outputDuration, commandString };
  } catch (error) {
    console.error("Error creating FFmpeg command:", error);
    return { error: error.message };
  }
}

function CombineImageAudioExample() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [audioFiles, setAudioFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [selectedAudioIds, setSelectedAudioIds] = useState([]);
  const [selectedImageIds, setSelectedImageIds] = useState([]);
  const [videoSrc, setVideoSrc] = useState("");
  const [message, setMessage] = useState("Select files and click Render Video");
  const [progress, setProgress] = useState(null);
  const [showCommand, setShowCommand] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isRendering, setIsRendering] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [modalImage, setModalImage] = useState(null);
  const modalUrlRef = useRef(null);
  const renderDurationRef = useRef(null);
  const lastElapsedRef = useRef(0);
  const [outputFilename, setOutputFilename] = useState("output");
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [videoWidth, setVideoWidth] = useState("1920");
  const [videoHeight, setVideoHeight] = useState("1080");
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [paddingColor, setPaddingColor] = useState("#000000");
  const [usePadding, setUsePadding] = useState(false);
  const [alwaysUniqueFilenames, setAlwaysUniqueFilenames] = useState(false);
  const [commandPreview, setCommandPreview] = useState("");
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
  const fileInputRef = useRef(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  useEffect(() => {
    // Auto-load ffmpeg core on initial mount
    if (mounted && !loadingRef.current && !loaded) {
      load(true);
    }
  }, [mounted, loaded]);

  const appendLog = (line) => {
    setLogs((prev) => {
      const next = [...prev, line];
      // cap log length to avoid runaway memory
      if (next.length > 500) {
        return next.slice(next.length - 500);
      }
      return next;
    });
  };

  const formatFileSize = (size) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  };

  const fileKey = (file) => `${file.name}-${file.size}-${file.type}`;
  const getMediaById = (id) => mediaFiles.find((item) => item.id === id) || null;
  const totalSelectedDurationSeconds = () =>
    selectedAudioIds
      .map((id) => getMediaById(id))
      .filter(Boolean)
      .reduce((acc, item) => acc + (item.durationSec || 0), 0);

  const updateDerivedMedia = (allFiles) => {
    const audios = allFiles.filter((item) => item.file.type.startsWith("audio/"));
    const images = allFiles.filter((item) => item.file.type.startsWith("image/"));
    setAudioFiles(audios.map((item) => item.file));
    setImageFiles(images.map((item) => item.file));

    const audioIdSet = new Set(selectedAudioIds);
    const imageIdSet = new Set(selectedImageIds);
    const nextAudioIds = audios.map((a) => a.id).filter((id) => audioIdSet.has(id));
    const nextImageIds = images.map((i) => i.id).filter((id) => imageIdSet.has(id));
    setSelectedAudioIds(nextAudioIds);
    setSelectedImageIds(nextImageIds);
  };

  const writeFileToFFmpeg = async (file) => {
    if (!loaded || !ffmpegRef.current) return;
    try {
      await ffmpegRef.current.writeFile(file.name, await fetchFile(file));
    } catch (err) {
      console.error("Failed to write file to ffmpeg FS", err);
    }
  };

  const writeFileToFFmpegNamed = async (fsName, file) => {
    if (!loaded || !ffmpegRef.current) return;
    try {
      await ffmpegRef.current.writeFile(fsName, await fetchFile(file));
    } catch (err) {
      console.error("Failed to write file to ffmpeg FS", err);
    }
  };

  const removeFileFromFFmpeg = async (file) => {
    if (!loaded || !ffmpegRef.current) return;
    try {
      await ffmpegRef.current.deleteFile(file.name);
    } catch (err) {
      // Ignore if file does not exist in FS
      console.warn("Could not delete file from ffmpeg FS", err?.message || err);
    }
  };

  const fetchAudioDuration = async (file, id) => {
    return new Promise((resolve) => {
      const audio = document.createElement("audio");
      const url = URL.createObjectURL(file);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const dur = isFinite(audio.duration) ? audio.duration : null;
        URL.revokeObjectURL(url);
        resolve(dur);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      audio.src = url;
    }).then((durationSec) => {
      if (durationSec) {
        setMediaFiles((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, durationSec } : item
          )
        );
      }
    });
  };

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setMediaFiles((prev) => {
      const existingKeys = new Set(prev.map((item) => `${item.file.name}-${item.file.size}-${item.file.type}`));
      const additions = files
        .filter((file) => file && file.name)
        .filter((file) => !existingKeys.has(`${file.name}-${file.size}-${file.type}`))
        .map((file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          durationSec: null,
        }));

      const updated = [...prev, ...additions];
      updateDerivedMedia(updated);

      // Immediately sync new files into ffmpeg FS if available
      additions.forEach((item) => writeFileToFFmpeg(item.file));
      // Fetch audio durations for new audio files
      additions
        .filter((item) => item.file.type.startsWith("audio/"))
        .forEach((item) => {
          fetchAudioDuration(item.file, item.id);
        });

      return updated;
    });
  };

  const handleFileChange = (event) => {
    addFiles(event.target.files);
  };

  const handleRemove = async (id) => {
    setMediaFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (!target) return prev;
      const remaining = prev.filter((item) => item.id !== id);
      updateDerivedMedia(remaining);
      removeFileFromFFmpeg(target.file);
      // Clear selections if removed file was selected
      setSelectedAudioIds((current) => current.filter((id) => id !== target.id));
      setSelectedImageIds((current) => current.filter((id) => id !== target.id));

      return remaining;
    });
  };

  const removeFile = async (targetFile) => {
    setMediaFiles((prev) => {
      const remaining = prev.filter((item) => fileKey(item.file) !== fileKey(targetFile));
      updateDerivedMedia(remaining);
      return remaining;
    });
    removeFileFromFFmpeg(targetFile);
    setSelectedAudioIds((current) => current.filter((id) => getFileById(id) !== targetFile));
    setSelectedImageIds((current) => current.filter((id) => getFileById(id) !== targetFile));
  };

  const removeFileById = async (id) => {
    const target = mediaFiles.find((item) => item.id === id);
    if (!target) return;
    await removeFile(target.file);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const clearAllFiles = async () => {
    const current = [...mediaFiles];
    await Promise.all(current.map((item) => removeFileFromFFmpeg(item.file)));
    setMediaFiles([]);
    setAudioFiles([]);
    setImageFiles([]);
    setSelectedAudioIds([]);
    setSelectedImageIds([]);
    setVideoSrc("");
    setFfmpegCommand([
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
    setCommandPreview("");
    setLogs([]);
    setMessage("Cleared all files.");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer?.files?.length) {
      addFiles(event.dataTransfer.files);
    }
  };

  const openModalForFile = (file) => {
    try {
      if (modalUrlRef.current) URL.revokeObjectURL(modalUrlRef.current);
      const url = URL.createObjectURL(file);
      modalUrlRef.current = url;
      setModalImage({ src: url, name: file.name });
    } catch (err) {
      console.warn("Unable to preview image", err);
    }
  };

  const closeModal = () => {
    if (modalUrlRef.current) {
      URL.revokeObjectURL(modalUrlRef.current);
      modalUrlRef.current = null;
    }
    setModalImage(null);
  };

  // Simple slideshow for selected images
  useEffect(() => {
    if (selectedImageIds.length <= 1) return;
    setSlideshowIndex(0);
    const interval = setInterval(() => {
      setSlideshowIndex((idx) => (idx + 1) % selectedImageIds.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedImageIds.length]);

  const extractCoverArt = async () => {
    const targetId =
      selectedAudioIds[0] ||
      mediaFiles.find((m) => m.file.type.startsWith("audio/"))?.id;
    if (!targetId) {
      setMessage("No audio file available to extract cover art.");
      return;
    }
    const audioItem = getMediaById(targetId);
    if (!audioItem) return;
    if (!loaded) {
      await load();
      if (!loaded) return;
    }
    const ffmpeg = ffmpegRef.current;
    const audioFsName = `${audioItem.id}-${audioItem.file.name}`;
    const coverName = `${audioItem.id}-cover.jpg`;
    try {
      await writeFileToFFmpegNamed(audioFsName, audioItem.file);
      await ffmpeg.exec([
        "-i", audioFsName,
        "-an",
        "-vcodec", "copy",
        "-map", "0:v:0",
        coverName
      ]);
      const data = await ffmpeg.readFile(coverName);
      const blob = new Blob([data.buffer], { type: "image/jpeg" });
      const coverFile = new File([blob], `${audioItem.file.name}-cover.jpg`, { type: "image/jpeg" });
      addFiles([coverFile]);
      setMessage("Cover art extracted and added as image.");
    } catch (err) {
      console.warn("Cover extraction failed", err);
      setMessage("No embedded cover art found or extraction failed.");
    } finally {
      try {
        await ffmpeg.deleteFile(audioFsName);
        await ffmpeg.deleteFile(coverName);
      } catch {}
    }
  };

  const parseTimeFromLine = (line) => {
    const match = line.match(/time=([\d:.]+)/);
    if (!match) return null;
    const parts = match[1].split(":").map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    return parts.reduce((acc, t) => 60 * acc + t, 0);
  };

  const load = async (isAuto = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setMessage(isAuto ? "Auto-loading ffmpeg-core..." : "Loading ffmpeg-core.js");
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => {
      console.log(message);
      appendLog(message);
      if (isRendering) {
        const elapsed = parseTimeFromLine(message);
        const total = renderDurationRef.current || totalSelectedDurationSeconds() || 0;
        if (elapsed !== null && total > 0) {
          lastElapsedRef.current = elapsed;
          const pct = Math.max(0, Math.min(1, elapsed / total));
          setProgress(pct);
        }
      }
    });
    ffmpeg.on("progress", ({ progress }) => {
      if (!isRendering) return; // ignore stale progress when not rendering
      const clamped = Math.max(0, Math.min(progress, 1));
      setProgress(clamped);
      console.log(`Progress: ${(clamped * 100).toFixed(1)}%`);
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    setLoaded(true);
    loadingRef.current = false;
    try {
      localStorage.setItem("ffmpegCoreLoaded", "true");
    } catch {}
    setMessage("Ready to render video");
  };

  const buildAndSetCommand = () => {
    if (selectedAudioIds.length === 0 || selectedImageIds.length === 0) {
      setMessage("Select at least one audio and one image to build command.");
      return null;
    }

    const selectedAudioItems = selectedAudioIds
      .map((id) => getMediaById(id))
      .filter(Boolean);
    const imageItem = getMediaById(selectedImageIds[0]);
    if (selectedAudioItems.length === 0 || !imageItem) {
      setMessage("Selection missing files.");
      return null;
    }
    const imageFile = imageItem.file;

    const safeOutputName = outputFilename.trim() || "output";
    const finalOutputName = alwaysUniqueFilenames
      ? `${safeOutputName}_${Date.now()}`
      : safeOutputName;
    const outputFilepath = `${finalOutputName}.${outputFormat}`;

    const audioInputs = selectedAudioItems.map((item) => ({
      filepath: `${item.id}-${item.file.name}`,
      duration: item.durationSec || 10,
      startTime: "",
      endTime: ""
    }));
    const totalDuration = audioInputs.reduce((acc, a) => acc + (a.duration || 0), 0);

    const imageInputs = [
      {
        filepath: `${imageItem.id}-${imageFile.name}`,
        width: Number(videoWidth) || 1920,
        height: Number(videoHeight) || 1080,
        stretchImageToFit: false,
        paddingColor: usePadding ? paddingColor : backgroundColor,
        useBlurBackground: false
      }
    ];

    const totalDurationSec = totalSelectedDurationSeconds();
    const { cmdArgs, commandString } = createFFmpegCommand({
      audioInputs,
      imageInputs,
      outputFilepath,
      width: Number(videoWidth) || 1920,
      height: Number(videoHeight) || 1080,
      paddingCheckbox: usePadding,
      backgroundColor,
      totalDurationOverride: totalDurationSec || null
    });

    if (cmdArgs && cmdArgs.length > 0) {
      setFfmpegCommand(cmdArgs);
      setCommandPreview(commandString);
      setMessage("FFmpeg command prepared.");
      return { cmdArgs, commandString, outputFilepath };
    }
    return null;
  };

  const renderVideo = async () => {
    if (isRendering) return;
    if (!loaded) {
      setMessage("Please load ffmpeg-core first.");
      return;
    }
    if (selectedAudioIds.length === 0 || selectedImageIds.length === 0) {
      setMessage("Please select at least one audio and one image file.");
      return;
    }
    const selectedAudioItems = selectedAudioIds
      .map((id) => getMediaById(id))
      .filter(Boolean);
    const selectedAudioItem = selectedAudioItems[0];
    const selectedImageItem = getMediaById(selectedImageIds[0]);
    if (selectedAudioItems.length === 0 || !selectedImageItem) {
      setMessage("Selection missing files.");
      return;
    }
    const selectedImage = selectedImageItem.file;
    const commandResult = buildAndSetCommand();
    if (!commandResult || !commandResult.cmdArgs) return;

    // Clear previous video while starting a new render
    setVideoSrc("");

    setIsRendering(true);
    setMessage("Preparing render (building command)...");
    setProgress(0);
    renderDurationRef.current = commandResult.outputDuration || totalSelectedDurationSeconds() || null;
    lastElapsedRef.current = 0;
    const initialCmdLine = commandResult.commandString
      ? `ffmpeg ${commandResult.commandString}`
      : `ffmpeg ${commandResult.cmdArgs.join(" ")}`;
    setLogs([initialCmdLine, "Writing input files to FFmpeg FS..."]);
    const ffmpeg = ffmpegRef.current;
    
    try {
      // Write files to ffmpeg FS
      for (const item of selectedAudioItems) {
        appendLog(`Writing audio: ${item.file.name}`);
        await writeFileToFFmpegNamed(`${item.id}-${item.file.name}`, item.file);
      }
      appendLog(`Writing image: ${selectedImage.name}`);
      await writeFileToFFmpegNamed(`${selectedImageItem.id}-${selectedImage.name}`, selectedImage);

      setMessage("Running FFmpeg...");
      appendLog("Starting ffmpeg exec...");
      // Run ffmpeg command
      await ffmpeg.exec(commandResult.cmdArgs);
      const data = await ffmpeg.readFile("output.mp4");
      const url = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
      setVideoSrc(url);
      setMessage("Complete rendering video");
    } catch (err) {
      console.error("Render error", err);
      setMessage(`Render failed: ${err?.message || err}`);
      appendLog(`Render failed: ${err?.message || err}`);
    } finally {
      setIsRendering(false);
      setProgress(null);
      renderDurationRef.current = null;
    }
  };

  const stopRender = async () => {
    if (!isRendering || !ffmpegRef.current) return;
    try {
      await ffmpegRef.current.exit?.();
    } catch (err) {
      console.warn("Stop render failed", err);
    } finally {
      setIsRendering(false);
      setProgress(null);
      renderDurationRef.current = null;
      setMessage("Render stopped");
    }
  };

  const updateCommandOption = (index, value) => {
    const newCommand = [...ffmpegCommand];
    newCommand[index] = value;
    setFfmpegCommand(newCommand);
  };

  if (!mounted) return null;

  return (
    <section 
      className={styles["ffmpeg-section"]}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h2>Combine Uploaded Image and Audio into a Video</h2>

      <div className={styles.coreBar}>
        <div>
          FFmpeg core: {loaded ? "Loaded" : "Loading..."}
        </div>
        {!loaded && (
          <button onClick={() => load(false)} className={styles.loadBtnInline}>
            Load ffmpeg-core (~31 MB)
          </button>
        )}
        {loaded && (
          <span className={styles.coreHint}>Auto-loaded; ready to render.</span>
        )}
      </div>
      
      <div className={styles["file-upload-section"]}>
        <div 
          className={`${styles.dropZone} ${isDragging ? styles.dragActive : ""}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <p className={styles.dropZoneTitle}>Drag & drop audio / video files anywhere on this page</p>
          <p className={styles.dropZoneSubtitle}>Or click to browse and select files</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            accept="audio/*,video/*,image/*"
            className={styles.hiddenFileInput}
          />
        </div>
        <div className={styles.uploadActions}>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={clearAllFiles}
            disabled={mediaFiles.length === 0}
          >
            Clear All Files
          </button>
        </div>
      </div>

      <div className={styles.renderOptions}>
        <div className={styles.renderOptionsHeader}>
          <h3>Render Options</h3>
          <button className={styles.smallButton} onClick={buildAndSetCommand}>
            Apply Options
          </button>
        </div>
        <div className={styles.renderGrid}>
          <label className={styles.renderField}>
            <span>Output Filename</span>
            <input
              type="text"
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              placeholder="output"
            />
          </label>
          <label className={styles.renderField}>
            <span>Format</span>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
            >
              <option value="mp4">mp4</option>
              <option value="mkv">mkv</option>
            </select>
          </label>
          <label className={styles.renderField}>
            <span>Width (px)</span>
            <input
              type="number"
              value={videoWidth}
              onChange={(e) => setVideoWidth(e.target.value)}
              min="1"
              max="7680"
            />
          </label>
          <label className={styles.renderField}>
            <span>Height (px)</span>
            <input
              type="number"
              value={videoHeight}
              onChange={(e) => setVideoHeight(e.target.value)}
              min="1"
              max="4320"
            />
          </label>
          <label className={styles.renderField}>
            <span>Background Color</span>
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
            />
          </label>
          <label className={styles.renderField}>
            <span>Padding Color</span>
            <input
              type="color"
              value={paddingColor}
              onChange={(e) => setPaddingColor(e.target.value)}
              disabled={!usePadding}
            />
          </label>
          <label className={styles.renderCheckbox}>
            <input
              type="checkbox"
              checked={usePadding}
              onChange={(e) => setUsePadding(e.target.checked)}
            />
            Use padding color (instead of fit)
          </label>
          <label className={styles.renderCheckbox}>
            <input
              type="checkbox"
              checked={alwaysUniqueFilenames}
              onChange={(e) => setAlwaysUniqueFilenames(e.target.checked)}
            />
            Always unique filenames
          </label>
        </div>
        {commandPreview && (
          <div className={styles.commandPreviewBox}>
            <div className={styles.commandPreviewLabel}>Generated command</div>
            <code>{commandPreview}</code>
          </div>
        )}
      </div>

      <div className={styles["files-display"]}>
        <Table
          title="Audio Files"
          data={mediaFiles
            .filter((item) => item.file.type.startsWith("audio/"))
            .map((item) => ({
              id: item.id,
              name: item.file.name,
              size: formatFileSize(item.file.size),
              type: item.file.type,
              length: formatDuration(item.durationSec),
              file: item.file,
            }))}
          setData={(rows) => {
            // reorder only audio within mediaFiles
            setMediaFiles((prev) => {
              const audios = prev.filter((p) => p.file.type.startsWith("audio/"));
              const images = prev.filter((p) => p.file.type.startsWith("image/"));
              const audioMap = new Map(audios.map((a) => [a.id, a]));
              const newAudios = rows.map((r) => audioMap.get(r.id)).filter(Boolean);
              return [...newAudios, ...images];
            });
          }}
          selectedIds={selectedAudioIds}
          onSelectionChange={(ids) => {
            setSelectedAudioIds(ids);
          }}
          onRemove={removeFileById}
          columns={[
            { header: "Name", accessorKey: "name", cell: (info) => info.getValue() },
            { header: "Size", accessorKey: "size", cell: (info) => info.getValue() },
            { header: "Type", accessorKey: "type", cell: (info) => info.getValue() },
            { header: "Length", accessorKey: "length", cell: (info) => info.getValue() },
          ]}
        />

        <Table
          title="Image Files"
          data={mediaFiles
            .filter((item) => item.file.type.startsWith("image/"))
            .map((item) => ({
              id: item.id,
              name: item.file.name,
              size: formatFileSize(item.file.size),
              type: item.file.type,
              preview: URL.createObjectURL(item.file),
              file: item.file,
            }))}
          setData={(rows) => {
            setMediaFiles((prev) => {
              const images = prev.filter((p) => p.file.type.startsWith("image/"));
              const audios = prev.filter((p) => p.file.type.startsWith("audio/"));
              const imageMap = new Map(images.map((i) => [i.id, i]));
              const newImages = rows.map((r) => imageMap.get(r.id)).filter(Boolean);
              return [...audios, ...newImages];
            });
          }}
          selectedIds={selectedImageIds}
          onSelectionChange={(ids) => {
            setSelectedImageIds(ids);
          }}
          onRemove={removeFileById}
          columns={[
            { 
              header: "Preview", 
              accessorKey: "preview", 
              cell: (info) => (
                <img 
                  src={info.getValue()} 
                  alt={info.row.original.name} 
                  className={styles.thumbnailImg}
                  onClick={() => openModalForFile(info.row.original.file)}
                />
              ) 
            },
            { header: "Name", accessorKey: "name", cell: (info) => info.getValue() },
            { header: "Size", accessorKey: "size", cell: (info) => info.getValue() },
            { header: "Type", accessorKey: "type", cell: (info) => info.getValue() },
          ]}
        />
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

      <div className={styles.selectionSummary}>
        <span>Audio selected: {selectedAudioIds.length}</span>
        <span>Images selected: {selectedImageIds.length}</span>
        <span>
          Total runtime:{" "}
          {formatDuration(totalSelectedDurationSeconds())}
        </span>
        <button className={styles.smallButton} onClick={extractCoverArt}>
          Extract cover from audio
        </button>
      </div>

      {selectedImageIds.length > 0 && (
        <div className={styles.slideshow}>
          <div className={styles.slideshowFrame}>
            <img
              src={
                getMediaById(selectedImageIds[slideshowIndex])
                  ? URL.createObjectURL(getMediaById(selectedImageIds[slideshowIndex]).file)
                  : ""
              }
              alt="Selected slideshow"
              className={styles.slideshowImage}
              onClick={() => {
                const item = getMediaById(selectedImageIds[slideshowIndex]);
                if (item) openModalForFile(item.file);
              }}
            />
          </div>
          <div className={styles.slideshowCaption}>
            {selectedImageIds.length > 1
              ? `Slideshow: ${slideshowIndex + 1} / ${selectedImageIds.length}`
              : "Slideshow: 1 / 1"}
          </div>
        </div>
      )}

      <div className={styles["video-output"]}>
        <h4>Generated Video</h4>
        {!videoSrc && <p className={styles.videoPlaceholder}>No video rendered yet. Render to preview.</p>}
        <div className={styles.videoFrame}>
          <video src={videoSrc || null} controls />
        </div>
        <div className={styles.videoMeta}>
          <span>Files: {selectedAudioIds.length} audio / {selectedImageIds.length} image</span>
          <span>
            Length: {formatDuration(totalSelectedDurationSeconds())}
          </span>
          <span>
            Size: {videoSrc ? "In-memory (download to know exact size)" : "—"}
          </span>
          <span>Type: video/mp4</span>
          {videoSrc && (
            <button
              className={styles.smallButton}
              onClick={() => {
                const a = document.createElement("a");
                a.href = videoSrc;
                a.download = "output.mp4";
                a.click();
              }}
            >
              Download video
            </button>
          )}
        </div>
      </div>

      {modalImage && (
        <div className={styles.modalBackdrop} onClick={closeModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={closeModal}>✕</button>
            <img src={modalImage.src} alt={modalImage.name} className={styles.modalImage} />
            <div className={styles.modalCaption}>{modalImage.name}</div>
          </div>
        </div>
      )}

      <div className={styles.logSection}>
        <div className={styles.logHeader}>
          <h4>FFmpeg Output</h4>
          <button className={styles.smallButton} onClick={() => setLogs([])}>Clear Logs</button>
        </div>
        <div className={styles.commandLine}>
          <span className={styles.commandLabel}>Command:</span>
          <code className={styles.commandText}>{commandPreview || `ffmpeg ${ffmpegCommand.join(" ")}`}</code>
        </div>
        <div className={styles.logBox}>
          {logs.length === 0 ? (
            <div className={styles.logPlaceholder}>No output yet. Run to see FFmpeg logs.</div>
          ) : (
            logs.map((line, idx) => (
              <div key={`${idx}-${line.slice(0,10)}`} className={styles.logLine}>{line}</div>
            ))
          )}
        </div>
      </div>

      <div className={styles["action-section"]}>
        <button 
          onClick={renderVideo} 
          className={styles["render-btn"]}
          disabled={isRendering || !loaded || selectedAudioIds.length === 0 || selectedImageIds.length === 0}
        >
          {isRendering ? "Rendering..." : loaded ? "Render Video" : "Loading core..."}
        </button>
        {isRendering && (
          <button
            onClick={stopRender}
            className={styles["load-btn"]}
            style={{ marginLeft: "0.75rem", background: "#e53e3e" }}
          >
            Stop Render
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
          <strong>FFMPEG WASM Sandbox</strong> - This is a sandbox project to test and demonstrate the capabilities of <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', textDecoration: 'none' }}>ffmpeg.wasm</a>, a browser-based video and audio processing library using FFmpeg WebAssembly.
        </p>
        <p style={{ fontSize: 14, color: '#666', marginBottom: 12, fontStyle: 'italic' }}>
          <strong>Note:</strong> I did not create ffmpeg.wasm - this is just a demo/testing sandbox. The actual ffmpeg.wasm library is developed by the <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', textDecoration: 'none' }}>ffmpegwasm team</a>.
        </p>
        <ul style={{ fontSize: 16, marginBottom: 8, paddingLeft: 22 }}>
          <li>Process video and audio files directly in your browser without server uploads.</li>
          <li>Combine images and audio files into video content using WebAssembly technology.</li>
          <li>Convert between different media formats and apply various filters and effects.</li>
          <li>Experience high-performance media processing with complete privacy and security.</li>
        </ul>
        <div style={{ marginTop: 16, padding: '12px', background: '#e9ecef', borderRadius: 4, fontSize: 14 }}>
          <strong>Attribution:</strong> This demo uses <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', textDecoration: 'none' }}>ffmpeg.wasm</a> by the ffmpegwasm team. Visit their <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', textDecoration: 'none' }}>GitHub repository</a> for more information and documentation.
        </div>
      </div>



      <CombineImageAudioExample />
    </main>
  );
}
