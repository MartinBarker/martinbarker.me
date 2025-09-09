'use client'
import React, { useState } from 'react';
import Link from 'next/link';
import styles from './rendertune.module.css';

export default function RenderTuneNotFound() {
  const [hoveredButton, setHoveredButton] = useState(null);

  return (
    <div className={styles.content} style={{ 
      textAlign: 'center', 
      padding: '4rem 2rem',
      minHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      color: '#ffffff',
      backgroundColor: '#1c1c1c'
    }}>
      <div style={{ maxWidth: '800px' }}>
        <h1 style={{ 
          fontSize: '12rem', 
          margin: '0 0 2rem 0',
          color: '#ff6b6b',
          fontWeight: 'bold',
          textShadow: '0 0 20px rgba(255, 107, 107, 0.5)',
          lineHeight: '0.8'
        }}>
          404
        </h1>
        <p style={{ 
          fontSize: '1.5rem', 
          margin: '0 0 3rem 0',
          color: '#cccccc',
          lineHeight: '1.6'
        }}>
          The RenderTune page you're looking for doesn't exist.
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link 
            href="/rendertune" 
            style={{
              display: 'inline-block',
              padding: '1rem 2rem',
              backgroundColor: hoveredButton === 'rendertune' ? '#45a049' : '#4CAF50',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '0.5rem',
              fontSize: '1.3rem',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: hoveredButton === 'rendertune' ? '0 6px 20px rgba(76, 175, 80, 0.4)' : '0 4px 15px rgba(76, 175, 80, 0.3)',
              transform: hoveredButton === 'rendertune' ? 'translateY(-3px)' : 'translateY(0)'
            }}
            onMouseEnter={() => setHoveredButton('rendertune')}
            onMouseLeave={() => setHoveredButton(null)}
          >
            Back to RenderTune
          </Link>
          <Link 
            href="/" 
            style={{
              display: 'inline-block',
              padding: '1rem 2rem',
              backgroundColor: hoveredButton === 'main' ? '#555' : '#333',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '0.5rem',
              fontSize: '1.3rem',
              fontWeight: 'bold',
              transition: 'all 0.3s ease',
              boxShadow: hoveredButton === 'main' ? '0 6px 20px rgba(51, 51, 51, 0.4)' : '0 4px 15px rgba(51, 51, 51, 0.3)',
              transform: hoveredButton === 'main' ? 'translateY(-3px)' : 'translateY(0)'
            }}
            onMouseEnter={() => setHoveredButton('main')}
            onMouseLeave={() => setHoveredButton(null)}
          >
            Return to martinbarker.me
          </Link>
        </div>
      </div>
    </div>
  );
}