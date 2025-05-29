const fs = require('fs');
const path = require('path');
const { Vibrant } = require('node-vibrant/node');
const sharp = require('sharp');

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

    // Create a thumbnail using Sharp, resizing to a 4MB limit while preserving dimensions
    await sharp(imagePath)
      .jpeg({ quality: 80 }) // Set quality to manage file size
      .toBuffer()
      .then(async data => {
        if (data.length > 4 * 1024 * 1024) { // Check if file size exceeds 4MB
          const reductionFactor = Math.sqrt(data.length / (4 * 1024 * 1024));
          await sharp(data)
            .resize({
              width: Math.round((await sharp(data).metadata()).width / reductionFactor),
              height: Math.round((await sharp(data).metadata()).height / reductionFactor)
            })
            .toFile(thumbnailPath);
        } else {
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

      if (isImage && !colorsData[file]) {
        processImage(file);
      } else if (!isImage && file !== 'thumbnails') {
        console.log(`Skipping non-image file: ${file}`);
      } else {
        console.log(`Skipping already processed image: ${file}`);
      }
    });
  });
};

// Run the ingestion process
ingestColors();
