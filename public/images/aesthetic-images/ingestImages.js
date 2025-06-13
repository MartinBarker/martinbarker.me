const fs = require('fs');
const path = require('path');
const { Vibrant } = require('node-vibrant/node');
const sharp = require('sharp');

// Parse command line arguments
const args = process.argv.slice(2);
const shouldRegenerateThumbnails = args.includes('--regenerate-thumbnails');

// Paths to folders and files
const imagesFolder = path.join(__dirname, 'images');
const thumbnailsFolder = path.join(__dirname, 'thumbnails'); // Changed to be outside 'images'
const colorsFilePath = path.join(__dirname, 'colors.json');

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
  }
};

// Run the thumbnail clearing logic before processing
clearThumbnails();

// Function to analyze colors and generate a thumbnail
const processImage = async (filename) => {
  const imagePath = path.join(imagesFolder, filename);
  const thumbnailFilename = `${path.parse(filename).name}-thumbnail.jpg`;
  const thumbnailPath = path.join(thumbnailsFolder, thumbnailFilename); // Use updated 'thumbnailsFolder'

  try {
    // Analyze colors using Vibrant.js
    const palette = await Vibrant.from(imagePath).getPalette();
    const colors = {
      Vibrant: palette.Vibrant.hex,
      LightVibrant: palette.LightVibrant.hex,
      DarkVibrant: palette.DarkVibrant.hex,
      Muted: palette.Muted.hex,
      LightMuted: palette.LightMuted.hex,
      DarkMuted: palette.DarkMuted.hex,
    };

    // Store colors in colors.json without the thumbnail path
    colorsData[filename] = { colors };
    fs.writeFileSync(colorsFilePath, JSON.stringify(colorsData, null, 2), 'utf-8');

    // Create a thumbnail using Sharp, following recommended thumbnail guidelines
    await sharp(imagePath)
      .resize({ 
        width: 320, // Standard thumbnail width (16:9 ratio will be ~180px height)
        withoutEnlargement: true // Don't enlarge smaller images
      })
      .jpeg({ 
        quality: 70,        // Lower quality for smaller file size
        progressive: true,  // Better web loading
        optimizeCoding: true // Optimize Huffman coding tables
      })
      .toBuffer()
      .then(async data => {
        // If still over target size (100KB), reduce quality further
        if (data.length > 100 * 1024) { 
          // Calculate appropriate quality to target ~50KB
          const qualityReduction = Math.min(30, Math.round(data.length / (50 * 1024)));
          await sharp(imagePath)
            .resize({ 
              width: 320,
              withoutEnlargement: true
            })
            .jpeg({ 
              quality: Math.max(40, 70 - qualityReduction), // Quality between 40-70%
              progressive: true,
              optimizeCoding: true
            })
            .toFile(thumbnailPath);
        } else {
          // Current size is good, save directly
          await sharp(data).toFile(thumbnailPath);
        }
      });

    console.log(`Processed and saved colors for ${filename}`);
  } catch (error) {
    console.error(`Failed to process ${filename}:`, error);
  }
};

// Main function to iterate over images in the folder
const ingestColors = () => {
  fs.readdir(imagesFolder, (err, files) => {
    if (err) {
      console.error('Error reading images folder:', err);
      return;
    }

    files.forEach((file) => {
      const fileExt = path.extname(file).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.jiff', '.jfif'].includes(fileExt); // Add '.jfif' to the list

      if (isImage && (!colorsData[file] || shouldRegenerateThumbnails)) {
        processImage(file);
      } else if (!isImage && file !== 'thumbnails') {
        console.log(`Skipping non-image file: ${file}`);
      } else if (!shouldRegenerateThumbnails) {
        console.log(`Skipping already processed image: ${file}`);
      }
    });
  });
};

// Run the ingestion process
ingestColors();
