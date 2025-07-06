"use client";
import { io } from "socket.io-client";
import { useEffect, useState } from "react";

// Custom hook to check if component is mounted (client-side only)
export function useHasMounted() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted;
}

// Only initialize socket.io client on the browser (never on SSR)
let socket = null;
let socketError = null;

if (typeof window !== "undefined") {
  const isLocal = window.location.hostname === "localhost";
  const socketPath = isLocal ? "/socket.io" : "/internal-api/socket.io";
  const socketUrl = isLocal ? "http://localhost:3030" : "https://www.jermasearch.com";

  try {
    console.log(`[Socket.IO] Initializing connection to ${socketUrl} with path ${socketPath}`);
    socket = io(socketUrl, {
      path: socketPath,
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Add connection event handlers
    socket.on("connect", () => {
      console.log(`[Socket.IO] Connected successfully with ID: ${socket.id}`);
    });

    socket.on("connect_error", (err) => {
      console.error(`[Socket.IO] Connection error: ${err.message}`);
      socketError = err.message;
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket.IO] Disconnected: ${reason}`);
    });

    socket.on("reconnect", (attemptNumber) => {
      console.log(`[Socket.IO] Reconnected after ${attemptNumber} attempts`);
    });
  } catch (err) {
    console.error(`[Socket.IO] Error initializing socket: ${err.message}`);
    socketError = err.message;
  }
}

// Custom hook to use socket status in components
export function useSocketStatus() {
  // Always start with disconnected for SSR consistency
  const [status, setStatus] = useState({
    connected: false,
    error: null
  });

  const hasMounted = useHasMounted();

  useEffect(() => {
    if (!socket) return;

    // Update status immediately on mount if connected
    if (socket.connected) {
      setStatus({ connected: true, error: null });
    }

    const onConnect = () => setStatus({ connected: true, error: null });
    const onDisconnect = () => setStatus({ connected: false, error: null });
    const onConnectError = (err) => setStatus({ connected: false, error: err.message });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [hasMounted]); // Add hasMounted dependency

  return { status, hasMounted };
}

// Custom hook to receive YouTube links in real-time
export function useYoutubeLinks() {
  const [youtubeLinks, setYoutubeLinks] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const onYoutubeLinks = (links) => {
      setYoutubeLinks((prevLinks) => [...prevLinks, ...links]);
    };

    socket.on("youtubeLinks", onYoutubeLinks);

    return () => {
      socket.off("youtubeLinks", onYoutubeLinks);
    };
  }, []);

  return youtubeLinks;
}

// Custom hook to receive YouTube results in real-time
export function useYoutubeResults() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const onResults = (videos) => {
      // videos is now an array of video objects with artist/title/year/discogsUrl
      console.log(`[Socket.IO] Real-time YouTube results received:`, videos);
      setResults((prevResults) => [...prevResults, ...videos]);
    };

    socket.on("results", onResults);

    return () => {
      socket.off("results", onResults);
    };
  }, []);

  return results;
}

export { socket };
