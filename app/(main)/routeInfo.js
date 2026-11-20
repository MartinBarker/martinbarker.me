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
    icon: "/icons/sites/tagger.png"
  },
  "/listogs": {
    title: "Listogs",
    subtitle: "Convert Discogs releases to playlists",
    tabTitle: "Listogs - Convert Discogs to Playlists",
    icon: "/icons/sites/listogs.png"
  },
  "/ALS2CUE": {
    tabTitle: "ALS2CUE - Ableton to CUE Converter",
    icon: "/icons/sites/als2cue.png"
  },
  "/popularify": {
    title: "Popularify",
    subtitle: "Get a spotify artist's entire discography sorted by popularity",
    tabTitle: "Popularify - Spotify Discography Sorter",
    icon: "/icons/sites/popularify.png"
  },
  "/vibrant": {
    title: "Vibrant.js Demo",
    subtitle: "Extract colors from images using Vibrant.js",
    tabTitle: "Vibrant.js Demo - Color Extraction",
    icon: "/icons/sites/vibrant.png"
  },
  "/trawl": {
    title: "",
    subtitle: "",
    tabTitle: "Trawl - Turn a Discord channel into a YouTube playlist",
    icon: "/icons/sites/trawl.png",
    description: "Trawl is a Discord bot that reads every music link shared in a channel and turns them into a single YouTube playlist — with one slash command.",
    ogImage: "/images/discord2playlist-icons/groove-app-icon-512.png",
    ogUrl: "https://martinbarker.me/trawl"
  },
  "/ffmpegwasm": {
    title: "FFMPEG WASM",
    subtitle: "Browser-based audio encoding with FFMPEG WebAssembly",
    tabTitle: "FFMPEG WASM - Browser Audio Processing",
    icon: "/icons/sites/ffmpegwasm.png"
  },
  "/vinyl2digital": {
    title: "Vinyl2Digital",
    subtitle: "Batch render Audacity audio tracks with Discogs metadata",
    tabTitle: "Vinyl2Digital - Vinyl Digitization Tool",
    icon: "/icons/sites/vinyl2digital.png"
  },
  "/auto-split": {
    title: "Auto-Split Tool",
    subtitle: "Detect silence in audio files with waveform visualization",
    tabTitle: "Auto-Split Tool - Audio Silence Detection",
    icon: "/icons/sites/auto-split.png"
  },
  "/waveform-visualizer": {
    title: "Waveform Visualizer",
    subtitle: "Visualize audio waveforms with interactive playback",
    tabTitle: "Waveform Visualizer - Audio Waveform Display",
    icon: "/icons/sites/waveform-visualizer.png"
  },
  "/color-review": {
    title: "Color Review",
    subtitle: "Review and edit image color palettes",
    tabTitle: "Color Review - Image Palette Editor",
    icon: "/icons/sites/color-review.png"
  },
  "/riptag": {
    title: "RipTag",
    subtitle: "Record, split, tag, and export your recordings",
    tabTitle: "RipTag – Record Audio Splitter | riptag.app",
    description: "RipTag (riptag.app) splits your record recordings into individual tracks, tags them with Discogs metadata, and exports tagged audio files — all in your browser.",
    ogImage: "/images/vinyldigitizer_previewCard.jpg",
    ogUrl: "https://riptag.app",
    icon: "/icons/sites/riptag.png"
  },

  "/bandcamposter": {
    title: "Bandcamp Poster",
    subtitle: "Turn a Bandcamp track into a 1080x1920 video",
    tabTitle: "Bandcamp Poster - Bandcamp track to vertical video",
    icon: "/icons/sites/bandcamposter.png"
  },
  "/discogs-theme-generator": {
    title: "Discogs Theme Generator",
    subtitle: "VS Code colour themes built from Discogs album art",
    tabTitle: "Discogs Theme Generator - VS Code & Cursor Extension",
    description: "A VS Code and Cursor extension that pulls a random vinyl release from Discogs, extracts the colours from its cover, and applies them to your editor.",
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

  // Sub-pages (/trawl/results/1) keep their site's tab icon.
  const root = getRouteRoot(pathname);
  if (info === defaultInfo && routeInfo[root]?.icon) {
    info = { ...info, icon: routeInfo[root].icon };
  }

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
 

// Name shown at the top of the sidebar. A branded site shows its own name on
// every one of its pages (so /trawl/results/1 still reads "Trawl"); the home
// page, Color Review and anything unbranded fall back to the portfolio name.
const SIDEBAR_TITLE_FALLBACK = "Martin Barker";
const SIDEBAR_TITLE_EXCLUDED = new Set(["/", "/color-review"]);
// Routes whose routeInfo entry has no usable `title`, or that live outside it.
const SIDEBAR_TITLE_OVERRIDES = {
  "/tagger": "Tagger",
  "/trawl": "Trawl",
  "/ALS2CUE": "ALS2CUE",
  "/rendertune": "RenderTune",
};

// The site a path belongs to. Longest matching root wins, matched on whole path
// segments so /riptagfoo doesn't count as /riptag.
function getRouteRoot(pathname) {
  if (!pathname) return undefined;
  const roots = [...new Set([...Object.keys(routeInfo), ...Object.keys(SIDEBAR_TITLE_OVERRIDES)])];
  return roots
    .filter(r => r !== "/" && (pathname === r || pathname.startsWith(`${r}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

export function getSidebarTitle(pathname) {
  const root = getRouteRoot(pathname);
  if (!root || SIDEBAR_TITLE_EXCLUDED.has(root)) return SIDEBAR_TITLE_FALLBACK;
  return SIDEBAR_TITLE_OVERRIDES[root] || routeInfo[root]?.title || SIDEBAR_TITLE_FALLBACK;
}

// Logo shape shown beside the sidebar name (SiteShell paints it in the text
// colour), or null where the name is the portfolio's. Each site's tab icon has a
// matching -mono.svg.
export function getSidebarIcon(pathname) {
  const root = getRouteRoot(pathname);
  if (!root || SIDEBAR_TITLE_EXCLUDED.has(root)) return null;
  const icon = routeInfo[root]?.icon;
  return icon?.startsWith("/icons/sites/") ? icon.replace(/\.png$/, "-mono.svg") : null;
}
