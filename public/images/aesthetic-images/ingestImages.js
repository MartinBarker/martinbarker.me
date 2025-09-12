/**
 * Processes images to generate dual thumbnails: mobile (150x150px, <15KB) + desktop (320x320px) and extracts color palettes.
 * Usage: node ingestImages.js [--regenerate-thumbnails]
 * Input: ./images/*.{jpg,jpeg,png,webp,jiff,jfif,bmp,tiff,tif,gif,svg} -> Output: ./thumbnails/*-thumbnail-mobile.jpg + *-thumbnail.jpg + ./colors.json
 * Mobile thumbnails: Ultra-compressed for fast mobile loading. Desktop: Higher quality for better visual experience.
 * Features: Exponential backoff retry, atomic file writes, duplicate filename handling.
 */

const fs = require('fs');
const path = require('path');
const { Vibrant } = require('node-vibrant/node');
const sharp = require('sharp');

// Parse command line arguments
const args = process.argv.slice(2);
const shouldRegenerateThumbnails = args.includes('--regenerate-thumbnails');

console.log('🖼️  Mobile-Optimized Image Processor');
console.log('=====================================');
if (shouldRegenerateThumbnails) {
  console.log('📱 Regenerating thumbnails with mobile optimizations...');
  console.log('✨ New features: 150x150px max size, <15KB files, progressive JPEG');
} else {
  console.log('📋 Processing new images only. Use --regenerate-thumbnails to recreate all.');
}
console.log('🔧 Filename sanitization: Removes quotes, spaces→underscores, special chars');

// Paths to folders and files
const imagesFolder = path.join(__dirname, 'images');
const thumbnailsFolder = path.join(__dirname, 'thumbnails'); // Changed to be outside 'images'
const colorsFilePath = path.join(__dirname, 'colors.json');

// Track used filenames to detect duplicates
const usedFilenames = new Set();

// Ensure colors.json file exists
if (!fs.existsSync(colorsFilePath)) {
  fs.writeFileSync(colorsFilePath, JSON.stringify({}, null, 2), 'utf-8');
}

// Load existing colors data
let colorsData = JSON.parse(fs.readFileSync(colorsFilePath, 'utf-8'));

// Ensure thumbnails folder exists
if (!fs.existsSync(thumbnailsFolder)) {
  fs.mkdirSync(thumbnailsFolder, { recursive: true });
}

// Function to delete all thumbnails if regeneration is requested
const clearThumbnails = () => {
  if (shouldRegenerateThumbnails) {
    console.log('Regenerating thumbnails - deleting existing thumbnails...');
    if (fs.existsSync(thumbnailsFolder)) {
      const files = fs.readdirSync(thumbnailsFolder);
      for (const file of files) {
        fs.unlinkSync(path.join(thumbnailsFolder, file));
      }
      console.log(`Deleted ${files.length} existing thumbnails`);
    }
    // Clear used filenames tracking for fresh start
    usedFilenames.clear();
  }
};

// Run the thumbnail clearing logic before processing
clearThumbnails();

// Function to sanitize filename for safe filesystem operations
const sanitizeFilename = (filename) => {
  return filename
    .replace(/['"]/g, '') // Remove quotes
    .replace(/[()]/g, '') // Remove parentheses
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^\w\-_.]/g, '') // Remove any other special characters except dash, underscore, dot
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
};

// Retry function with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 100) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      console.log(`   ⚠️  Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Function to safely write to colors.json with retry logic
const writeColorsData = async (filename, colors) => {
  return retryWithBackoff(async () => {
    // Re-read the latest colors data to avoid conflicts
    let currentColorsData = {};
    if (fs.existsSync(colorsFilePath)) {
      try {
        const data = fs.readFileSync(colorsFilePath, 'utf-8');
        currentColorsData = JSON.parse(data);
      } catch (error) {
        console.log(`   ⚠️  Colors file corrupted, creating fresh copy...`);
        currentColorsData = {};
      }
    }
    
    // Update with new data
    currentColorsData[filename] = { colors };
    
    // Write atomically by writing to temp file first
    const tempPath = colorsFilePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(currentColorsData, null, 2), 'utf-8');
    fs.renameSync(tempPath, colorsFilePath);
  }, 5, 50); // 5 retries, starting with 50ms delay
};

// Function to analyze colors and generate thumbnails (both mobile and desktop)
const processImage = async (filename) => {
  const imagePath = path.join(imagesFolder, filename);
  const baseName = path.parse(filename).name;
  let sanitizedBaseName = sanitizeFilename(baseName);
  
  // Handle duplicate sanitized names by adding a counter
  let counter = 1;
  let originalSanitized = sanitizedBaseName;
  while (usedFilenames.has(sanitizedBaseName)) {
    sanitizedBaseName = `${originalSanitized}_${counter}`;
    counter++;
  }
  usedFilenames.add(sanitizedBaseName);
  
  const mobileThumbFilename = `${sanitizedBaseName}-thumbnail-mobile.jpg`;
  const desktopThumbFilename = `${sanitizedBaseName}-thumbnail.jpg`;
  const mobileThumbPath = path.join(thumbnailsFolder, mobileThumbFilename);
  const desktopThumbPath = path.join(thumbnailsFolder, desktopThumbFilename);

  try {
    // Check if file exists and is readable
    if (!fs.existsSync(imagePath)) {
      throw new Error(`File not found: ${imagePath}`);
    }

    // Analyze colors using Vibrant.js
    const palette = await Vibrant.from(imagePath).getPalette();
    
    // Ensure all color swatches exist before processing
    const colors = {
      Vibrant: palette.Vibrant?.hex || '#ffffff',
      LightVibrant: palette.LightVibrant?.hex || '#ffffff',
      DarkVibrant: palette.DarkVibrant?.hex || '#000000',
      Muted: palette.Muted?.hex || '#cccccc',
      LightMuted: palette.LightMuted?.hex || '#eeeeee',
      DarkMuted: palette.DarkMuted?.hex || '#333333',
    };

    // Store colors in colors.json with retry logic
    await writeColorsData(filename, colors);

    // Generate mobile-optimized thumbnail (ultra-small for mobile performance)
    const mobileOptimizedBuffer = await sharp(imagePath)
      .resize({ 
        width: 150, // Small for mobile sidebar
        height: 150, // Square format for sidebar
        fit: 'cover', // Crop to fill the square
        position: 'center'
      })
      .jpeg({ 
        quality: 60,        // Reduced quality for mobile
        progressive: true,  // Better web loading
        optimizeCoding: true, // Optimize Huffman coding tables
        mozjpeg: true       // Use mozjpeg encoder for better compression
      })
      .toBuffer();

    // Target very small file size for mobile performance (max 15KB)
    if (mobileOptimizedBuffer.length > 15 * 1024) {
      // Aggressively reduce size for mobile performance
      const targetQuality = Math.max(30, Math.round(50 * (15 * 1024) / mobileOptimizedBuffer.length));
      
      await sharp(imagePath)
        .resize({ 
          width: 120, // Even smaller if needed
          height: 120,
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ 
          quality: targetQuality, // Very low quality for tiny file size
          progressive: true,
          optimizeCoding: true,
          mozjpeg: true
        })
        .toFile(mobileThumbPath);
    } else {
      // Size is acceptable, save the buffer
      await sharp(mobileOptimizedBuffer).toFile(mobileThumbPath);
    }

    // Generate desktop thumbnail (higher quality, larger size)
    await sharp(imagePath)
      .resize({ 
        width: 320, // Larger for desktop
        height: 320, // Square format for consistency
        fit: 'cover', // Crop to fill the square
        position: 'center'
      })
      .jpeg({ 
        quality: 80,        // Higher quality for desktop
        progressive: true,  // Better web loading
        optimizeCoding: true
      })
      .toFile(desktopThumbPath);

    // Verify thumbnails were actually created
    if (!fs.existsSync(mobileThumbPath)) {
      throw new Error(`Mobile thumbnail not created: ${mobileThumbFilename}`);
    }
    if (!fs.existsSync(desktopThumbPath)) {
      throw new Error(`Desktop thumbnail not created: ${desktopThumbFilename}`);
    }
    
    // Thumbnails generated and verified successfully
  } catch (error) {
    console.error(`Failed to process ${filename}:`, error);
  }
};

// Main function to iterate over images in the folder
const ingestColors = () => {
  fs.readdir(imagesFolder, async (err, files) => {
    if (err) {
      console.error('Error reading images folder:', err);
      return;
    }

    // Count and categorize all files
    let totalFiles = files.length;
    let imageFiles = 0;
    let nonImageFiles = 0;
    let alreadyProcessed = 0;
    let toProcess = 0;
    let processed = 0;
    let failed = 0;

    console.log(`\n📊 Found ${totalFiles} total files in images folder`);

    // First pass: count and categorize
    files.forEach((file) => {
      const fileExt = path.extname(file).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.jiff', '.jfif', '.webp', '.bmp', '.tiff', '.tif', '.gif', '.svg'].includes(fileExt);

      if (isImage) {
        imageFiles++;
        if (!colorsData[file] || shouldRegenerateThumbnails) {
          toProcess++;
        } else {
          alreadyProcessed++;
        }
      } else if (file !== 'thumbnails') {
        nonImageFiles++;
      }
    });

    console.log(`📸 Image files: ${imageFiles}`);
    console.log(`📄 Non-image files: ${nonImageFiles}`);
    console.log(`✅ Already processed: ${alreadyProcessed}`);
    console.log(`🔄 To process: ${toProcess}`);
    console.log('');

    // Second pass: process files sequentially with real-time progress
    let currentIndex = 0;
    const imagesToProcess = files.filter(file => {
      const fileExt = path.extname(file).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.jiff', '.jfif', '.webp', '.bmp', '.tiff', '.tif', '.gif', '.svg'].includes(fileExt);
      return isImage && (!colorsData[file] || shouldRegenerateThumbnails);
    });

    // Check for potential filename conflicts before processing
    const sanitizedNames = new Map();
    const conflicts = [];
    
    imagesToProcess.forEach(file => {
      const baseName = path.parse(file).name;
      const sanitized = sanitizeFilename(baseName);
      
      if (sanitizedNames.has(sanitized)) {
        conflicts.push({
          original1: sanitizedNames.get(sanitized),
          original2: file,
          sanitized: sanitized
        });
      } else {
        sanitizedNames.set(sanitized, file);
      }
    });
    
    if (conflicts.length > 0) {
      console.log(`⚠️  Found ${conflicts.length} potential filename conflicts:`);
      conflicts.forEach(conflict => {
        console.log(`   "${conflict.original1}" and "${conflict.original2}" → both sanitize to "${conflict.sanitized}"`);
      });
      console.log(`   Will add counters to resolve conflicts (e.g., "${conflicts[0].sanitized}_1", "${conflicts[0].sanitized}_2")\n`);
    }

    console.log(`\n🚀 Starting processing of ${imagesToProcess.length} images...\n`);

    for (const file of imagesToProcess) {
      currentIndex++;
      const fileExt = path.extname(file).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.jiff', '.jfif', '.webp', '.bmp', '.tiff', '.tif', '.gif', '.svg'].includes(fileExt);

      if (isImage && (!colorsData[file] || shouldRegenerateThumbnails)) {
        try {
          const baseName = path.parse(file).name;
          const sanitizedBaseName = sanitizeFilename(baseName);
          const isRenamed = sanitizedBaseName !== baseName;
          
          console.log(`🔄 [${currentIndex}/${imagesToProcess.length}] Processing: ${file}${isRenamed ? ` → ${sanitizedBaseName}` : ''}`);
          await processImage(file);
          processed++;
          console.log(`✅ [${currentIndex}/${imagesToProcess.length}] Completed: ${file} (${processed} total completed)`);
        } catch (error) {
          failed++;
          console.error(`❌ [${currentIndex}/${imagesToProcess.length}] Failed: ${file} - ${error.message} (${failed} total failed)`);
        }
      }
      
      // Show progress every 50 files
      if (currentIndex % 50 === 0 || currentIndex === imagesToProcess.length) {
        const percent = Math.round((currentIndex / imagesToProcess.length) * 100);
        console.log(`\n📊 Progress: ${currentIndex}/${imagesToProcess.length} (${percent}%) | ✅ ${processed} completed | ❌ ${failed} failed\n`);
      }
    }

    // Process the promise array (now empty, but needed for the final summary)
    const processPromises = [];

    // Wait for all processing to complete and show final summary
    Promise.all(processPromises).then(() => {
      console.log('\n🎉 Processing Complete!');
      console.log(`📊 Final Summary:`);
      console.log(`   Total files found: ${totalFiles}`);
      console.log(`   Image files: ${imageFiles}`);
      console.log(`   Successfully processed: ${processed}`);
      console.log(`   Already had thumbnails: ${alreadyProcessed}`);
      console.log(`   Failed to process: ${failed}`);
      console.log(`   Total thumbnails: ${processed + alreadyProcessed}`);
      
      // Check thumbnail folder count and identify missing files
      if (fs.existsSync(thumbnailsFolder)) {
        const mobileThumbFiles = fs.readdirSync(thumbnailsFolder).filter(f => f.endsWith('-thumbnail-mobile.jpg'));
        const desktopThumbFiles = fs.readdirSync(thumbnailsFolder).filter(f => f.endsWith('-thumbnail.jpg') && !f.endsWith('-thumbnail-mobile.jpg'));
        console.log(`   Mobile thumbnail files on disk: ${mobileThumbFiles.length}`);
        console.log(`   Desktop thumbnail files on disk: ${desktopThumbFiles.length}`);
        
        const expectedThumbs = processed + alreadyProcessed;
        if (mobileThumbFiles.length !== expectedThumbs || desktopThumbFiles.length !== expectedThumbs) {
          console.log(`⚠️  Warning: Thumbnail count mismatch!`);
          console.log(`     Expected: ${expectedThumbs} of each type`);
          console.log(`     Found: ${mobileThumbFiles.length} mobile, ${desktopThumbFiles.length} desktop`);
          
          // Find which files are missing thumbnails
          const imageFiles = files.filter(file => {
            const fileExt = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.jiff', '.jfif', '.webp', '.bmp', '.tiff', '.tif', '.gif', '.svg'].includes(fileExt);
          });
          
          const missingMobile = [];
          const missingDesktop = [];
          
          imageFiles.forEach(imageFile => {
            const baseName = path.parse(imageFile).name;
            const sanitizedBaseName = sanitizeFilename(baseName);
            const expectedMobile = `${sanitizedBaseName}-thumbnail-mobile.jpg`;
            const expectedDesktop = `${sanitizedBaseName}-thumbnail.jpg`;
            
            if (!mobileThumbFiles.includes(expectedMobile)) {
              missingMobile.push(imageFile);
            }
            if (!desktopThumbFiles.includes(expectedDesktop)) {
              missingDesktop.push(imageFile);
            }
          });
          
          if (missingMobile.length > 0) {
            console.log(`\n❌ Missing mobile thumbnails for:`);
            missingMobile.forEach(file => console.log(`   - ${file}`));
          }
          
          if (missingDesktop.length > 0) {
            console.log(`\n❌ Missing desktop thumbnails for:`);
            missingDesktop.forEach(file => console.log(`   - ${file}`));
          }
          
          // Check for problematic filenames that might cause issues
          const problematicFiles = imageFiles.filter(file => 
            file.includes(' ') || file.includes('(') || file.includes(')') || file.includes("'")
          );
          
          if (problematicFiles.length > 0) {
            console.log(`\n⚠️  Files with special characters that might cause issues:`);
            problematicFiles.forEach(file => console.log(`   - "${file}"`));
          }
        }
      }
    });
  });
};

// Run the ingestion process
ingestColors();
