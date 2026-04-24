'use client';
/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { initFirebase } from '../../utils/firebase';

export default function UserTest() {
  const [fb, setFb] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [moviesText, setMoviesText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    (async () => {
      try {
        const firebase = await initFirebase();
        if (cancelled) return;
        setFb(firebase);
        unsub = onAuthStateChanged(firebase.auth, (u) => {
          setUser(u);
          setLoading(false);
        });
      } catch (e) {
        if (!cancelled) {
          setError(`Firebase init failed: ${e.message || e}`);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    if (!fb || !user) {
      setMoviesText('');
      setSavedText('');
      return;
    }
    let cancelled = false;
    (async () => {
      setMoviesLoading(true);
      setError(null);
      try {
        const ref = doc(fb.db, 'users', user.uid);
        const snap = await getDoc(ref);
        const text = snap.exists() ? (snap.data().favoriteMovies || '') : '';
        if (!cancelled) {
          setMoviesText(text);
          setSavedText(text);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setMoviesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fb, user]);

  const handleSaveMovies = async () => {
    if (!fb || !user) return;
    setSaving(true);
    setSaveStatus('');
    setError(null);
    try {
      const ref = doc(fb.db, 'users', user.uid);
      await setDoc(
        ref,
        {
          favoriteMovies: moviesText,
          email: user.email || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setSavedText(moviesText);
      setSaveStatus('Saved');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const isDirty = moviesText !== savedText;

  const handleSignIn = async () => {
    if (!fb) return;
    setError(null);
    try {
      await signInWithPopup(fb.auth, fb.googleProvider);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const handleSignOut = async () => {
    if (!fb) return;
    setError(null);
    try {
      await signOut(fb.auth);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const containerStyle = {
    maxWidth: 720,
    margin: '2rem auto',
    padding: '1.5rem',
    fontFamily: 'system-ui, sans-serif',
    background: 'rgba(255,255,255,0.85)',
    borderRadius: 8,
    color: '#111',
  };

  const buttonStyle = {
    padding: '0.6rem 1rem',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  };

  const preStyle = {
    background: '#111',
    color: '#0f0',
    padding: '1rem',
    borderRadius: 6,
    overflowX: 'auto',
    fontSize: 12,
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <h1>/usertest</h1>
        <p>Loading auth state...</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1>/usertest — Firebase Auth</h1>
      <p>Hidden test page for inspecting the signed-in Firebase user.</p>

      {error && (
        <div style={{ background: '#fee', color: '#900', padding: '0.75rem', borderRadius: 6, marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {!user ? (
        <button style={buttonStyle} onClick={handleSignIn}>
          Sign in with Google
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            {user.photoURL && (
              <img
                src={user.photoURL}
                alt="avatar"
                width={56}
                height={56}
                style={{ borderRadius: '50%' }}
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <div style={{ fontWeight: 700 }}>{user.displayName || '(no displayName)'}</div>
              <div>{user.email}</div>
              <div style={{ fontSize: 12, color: '#555' }}>uid: {user.uid}</div>
            </div>
          </div>

          <button style={buttonStyle} onClick={handleSignOut}>Sign out</button>

          <h3 style={{ marginTop: '1.5rem' }}>Favorite movies</h3>
          {moviesLoading ? (
            <p>Loading your movies...</p>
          ) : (
            <>
              <textarea
                value={moviesText}
                onChange={(e) => { setMoviesText(e.target.value); setSaveStatus(''); }}
                placeholder="One movie per line..."
                rows={10}
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  borderRadius: 6,
                  border: '1px solid #999',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  style={{ ...buttonStyle, opacity: saving || !isDirty ? 0.6 : 1 }}
                  onClick={handleSaveMovies}
                  disabled={saving || !isDirty}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {isDirty && <span style={{ color: '#a60' }}>Unsaved changes</span>}
                {!isDirty && saveStatus && <span style={{ color: '#070' }}>{saveStatus}</span>}
              </div>
            </>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Full user object</h3>
          <pre style={preStyle}>{JSON.stringify(user.toJSON(), null, 2)}</pre>
        </>
      )}
    </div>
  );
}
