# Armature Identifier

A web-based 3D tool for analyzing FBX skeletal meshes, viewing bone hierarchies, and exporting animation data.

## Quick Start

**Method 1: Double-click `start.bat`**
- This will automatically start the server and open your browser

**Method 2: Manual start**
1. Open command prompt in this folder
2. Run: `python server.py`
3. Open http://localhost:8000 in your browser

## Features

- **FBX File Loading**: Upload and view FBX files with skeletal animations
- **Real-time Bone Analysis**: View bone names, positions, rotations, and scales
- **Animation Controls**: Play, pause, scrub, and control playback speed
- **3D Visualization**: Interactive 3D viewer with skeleton overlay
- **JSON Export**: Export complete animation data frame-by-frame

## Usage

1. Click "Choose File" and select your FBX file
2. The model loads with a green skeleton visualization
3. View bone data in the right sidebar (updates in real-time)
4. Use animation controls to play/pause and scrub through frames
5. Export animation data as JSON with frame-by-frame transforms

## Requirements

- Python 3.x
- Modern web browser (Chrome, Firefox, Edge)
- FBX files with skeletal mesh and animations

## Troubleshooting

If you get CORS errors, make sure you're using the local server (not opening index.html directly).