#!/bin/bash

# ------------------------------------------------------------
# Script: YouTube Playlist Thumbnail Collage Generator
#
# Description:
# This script downloads thumbnails from a specified YouTube playlist using yt-dlp,
# trims black borders, resizes the thumbnails to square dimensions, and creates
# a collage as a single output image. It also prints a key showing where each image
# appears in the grid, based on filenames and grid positions.
#
# Prerequisites:
# - yt-dlp (to download thumbnails)
# - ImageMagick (to process and montage images)
#
# Setup:
# 1. Install yt-dlp and ImageMagick:
#    - For yt-dlp: https://github.com/yt-dlp/yt-dlp
#    - For ImageMagick: https://imagemagick.org
# 2. Replace the playlist URL with your desired YouTube playlist.
# 3. Ensure the script has executable permissions:
#    chmod +x script.sh
#
# Usage:
# Run the script from the terminal in the directory where you want the output:
#    ./script.sh
#
# ------------------------------------------------------------

# Download thumbnails from each video
# yt-dlp --skip-download --write-thumbnail --output "%(title)s - %(uploader)s.%(ext)s" https://www.youtube.com/playlist?list=PLpQuORMLvnZaiPB9Q5dJ_27I-7bV9Ior8

# Check if ImageMagick is installed
if ! command -v montage &> /dev/null || ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is not installed. Install it first."
    exit 1
fi

# Set output file name
output_file="collage_output.png"

# Gather all .webp files in the folder
image_files=( *.webp )

# Check if there are any .webp files in the folder
if [ ${#image_files[@]} -eq 0 ]; then
    echo "No .webp files found in the current directory."
    exit 1
fi

# Crop black borders from each image, resize to square dimensions, and save temporary cropped images
temp_dir="cropped_images"
mkdir -p "$temp_dir"
for image in "${image_files[@]}"; do
    convert "$image" -trim -resize "500x500^" -gravity center -extent 500x500 "$temp_dir/$image"
done

# Set the number of rows and columns for a 7x7 grid layout
side_length=7

# Print a key showing filenames and their grid positions
echo "\nImage Grid Key:"
row=1
col=1
for (( i=0; i<${#image_files[@]}; i++ )); do
    image_name=$(basename "${image_files[$i]}")
    printf "Row %d, Col %d: %s\n" "$row" "$col" "$image_name"
    ((col++))
    if (( col > side_length )); then
        col=1
        ((row++))
    fi
done

# Generate the collage using ImageMagick's montage tool ensuring even grid with no spacing
montage "$temp_dir"/*.webp -tile ${side_length}x${side_length} -geometry +0+0 -border 0 "$output_file"

# Clean up temporary directory
rm -rf "$temp_dir"

# Notify the user
if [ $? -eq 0 ]; then
    echo "\nCollage created successfully: $output_file"
else
    echo "\nAn error occurred while creating the collage."
fi
