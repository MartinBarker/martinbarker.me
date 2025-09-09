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
  "/discord2playlist": {
    title: "",
    subtitle: "",
    tabTitle: "Discord2Playlist - Convert Discord Music to Playlists",
    icon: "/ico/martinbarker.ico"
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
 