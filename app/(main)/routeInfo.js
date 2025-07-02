// Shared route information for the application

export const routeInfo = {
  "/": {
    title: "Martin Barker",
    subtitle: "Software Developer Portfolio",
    icon: "/ico/martinbarker.ico"
  },
  "/tagger": {
    title: "tagger.site",
    subtitle: "Generate timestamped tracklists and comma seperated tags from audio files or URLs",
    icon: "/ico/martinbarker.ico"
  },
  "/discogs2youtube": {
    title: "Discogs2Youtube",
    subtitle: "Convert Discogs releases to playlists",
    icon: "/ico/martinbarker.ico"
  },
  "/ffmpegwasm": {
    title: "FFMPEG WASM",
    subtitle: "Browser-based audio encoding with FFMPEG WebAssembly",
    icon: "/ico/martinbarker.ico"
  },
  "/popularify": {
    title: "Popularify",
    subtitle: "Get a spotify artist's entire discography sorted by popularity",
    icon: "/ico/martinbarker.ico"
  }
};

export const defaultInfo = {
  title: "",
  subtitle: "",
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
