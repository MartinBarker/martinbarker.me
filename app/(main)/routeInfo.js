// Shared route information for the application

export const routeInfo = {
  "/": {
    title: "Martin Barker",
    subtitle: "Software Developer Portfolio",
    tabTitle: "Martin Barker - Software Developer Portfolio",
    icon: "/ico/martinbarker.ico"
  },
  "/tagger": {
    tabTitle: "tagger.site - Music Metadata Tool",
    icon: "/ico/martinbarker.ico"
  },
  "/listogs": {
    title: "Listogs",
    subtitle: "Convert Discogs releases to playlists",
    tabTitle: "Listogs - Convert Discogs to Playlists",
    icon: "/ico/martinbarker.ico"
  },
  "/ALS2CUE": {
    tabTitle: "ALS2CUE - Ableton to CUE Converter",
    icon: "/ico/martinbarker.ico"
  },
  "/popularify": {
    title: "Popularify",
    subtitle: "Get a spotify artist's entire discography sorted by popularity",
    tabTitle: "Popularify - Spotify Discography Sorter",
    icon: "/ico/martinbarker.ico"
  },
  "/vibrant": {
    title: "Vibrant.js Demo",
    subtitle: "Extract colors from images using Vibrant.js",
    tabTitle: "Vibrant.js Demo - Color Extraction",
    icon: "/ico/martinbarker.ico"
  },
  "/trawl": {
    title: "",
    subtitle: "",
    tabTitle: "Trawl - Turn a Discord channel into a YouTube playlist",
    icon: "/images/discord2playlist-icons/groove-square-128.png",
    description: "Trawl is a Discord bot that reads every music link shared in a channel and turns them into a single YouTube playlist — with one slash command.",
    ogImage: "/images/discord2playlist-icons/groove-app-icon-512.png",
    ogUrl: "https://martinbarker.me/trawl"
  },
  "/ffmpegwasm": {
    title: "FFMPEG WASM",
    subtitle: "Browser-based audio encoding with FFMPEG WebAssembly",
    tabTitle: "FFMPEG WASM - Browser Audio Processing",
    icon: "/ico/martinbarker.ico"
  },
  "/vinyl2digital": {
    title: "Vinyl2Digital",
    subtitle: "Batch render Audacity audio tracks with Discogs metadata",
    tabTitle: "Vinyl2Digital - Vinyl Digitization Tool",
    icon: "/ico/martinbarker.ico"
  },
  "/auto-split": {
    title: "Auto-Split Tool",
    subtitle: "Detect silence in audio files with waveform visualization",
    tabTitle: "Auto-Split Tool - Audio Silence Detection",
    icon: "/ico/martinbarker.ico"
  },
  "/waveform-visualizer": {
    title: "Waveform Visualizer",
    subtitle: "Visualize audio waveforms with interactive playback",
    tabTitle: "Waveform Visualizer - Audio Waveform Display",
    icon: "/ico/martinbarker.ico"
  },
  "/color-review": {
    title: "Color Review",
    subtitle: "Review and edit image color palettes",
    tabTitle: "Color Review - Image Palette Editor",
    icon: "/ico/martinbarker.ico"
  },
  "/riptag": {
    title: "RipTag",
    subtitle: "Record, split, tag, and export your recordings",
    tabTitle: "RipTag – Record Audio Splitter | riptag.app",
    description: "RipTag (riptag.app) splits your record recordings into individual tracks, tags them with Discogs metadata, and exports tagged audio files — all in your browser.",
    ogImage: "/images/vinyldigitizer_previewCard.jpg",
    ogUrl: "https://riptag.app",
    icon: "/ico/martinbarker.ico"
  }
};

export const defaultInfo = {
  title: "",
  subtitle: "",
  tabTitle: "",
  icon: "/ico/martinbarker.ico"
};

// Helper to get route info, with special handling for paths
export function getRouteInfo(pathname) {
  let info = routeInfo[pathname] || defaultInfo;
  
  // Special handling for nested routes
  if (pathname.startsWith("/tagger/")) {
    info = routeInfo["/tagger"];
  }
  else if (pathname.startsWith("/rendertune")) {
    info = {
      ...info,
      icon: "/ico/rendertune.ico",
      title: info.title || "RenderTune",
      subtitle: info.subtitle || "Video Rendering App"
    };
  }
  
  return info;
}
 