'use client'
import React from 'react';
import Link from 'next/link';
import { Home, Music, FileMusicIcon, BarChart, Mail, Github, Linkedin, Menu, ChevronRight, Contact, FileText as ResumeIcon, Palette, Video, List, FileText, Zap } from 'lucide-react';
import styles from './(main)/layout.module.css';
import { ColorContext } from './(main)/ColorContext';
import ImageModal from './(main)/ImageModal/ImageModal';

// Import the layout component from the main layout
import RootLayout from './(main)/layout';

export default function GlobalNotFound() {
  return (
    <RootLayout>
      <div style={{ 
        textAlign: 'center', 
        padding: '2rem',
        minHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <h1 style={{ fontSize: '4rem', margin: '0 0 1rem 0' }}>404</h1>
        <h2 style={{ fontSize: '2rem', margin: '0 0 1rem 0' }}>Page Not Found</h2>
        <p style={{ fontSize: '1.2rem', margin: '0 0 2rem 0' }}>
          The page you're looking for doesn't exist.
        </p>
        <Link 
          href="/" 
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            backgroundColor: '#333',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '0.5rem',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            transition: 'all 0.3s ease'
          }}
        >
          Return Home
        </Link>
      </div>
    </RootLayout>
  );
}
