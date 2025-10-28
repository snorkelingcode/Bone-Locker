const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const FBXParser = require('fbx-parser');

const app = express();
const PORT = 3001;

// Enable CORS for all routes
app.use(cors());

// Increase payload limits for large animation data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '_' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// Serve static files
app.use(express.static(__dirname));

// Upload FBX file
app.post('/upload-fbx', upload.single('fbx'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('FBX file uploaded:', req.file.filename);
    res.json({
        success: true,
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path
    });
});

// Process FBX with modified animation data
app.post('/process-fbx', (req, res) => {
    try {
        const { filename, smoothingRules, animationData, modifiedBoneData } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'No filename provided' });
        }

        const filePath = path.join(__dirname, 'uploads', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        console.log('Processing FBX:', filename);
        console.log('Smoothing rules:', smoothingRules ? smoothingRules.length : 0);
        console.log('Animation data available:', !!animationData);
        console.log('Modified bone data available:', !!modifiedBoneData);

        if (modifiedBoneData) {
            console.log('Modified animation tracks:', modifiedBoneData.tracks ? modifiedBoneData.tracks.length : 0);
        }

        // Read the original FBX file
        const fbxData = fs.readFileSync(filePath);

        // Apply the modified bone data to the FBX
        const processedFbxData = applyModifiedAnimationData(fbxData, modifiedBoneData, animationData);

        // Save the processed file
        const processedFilename = 'cleaned_' + filename;
        const processedPath = path.join(__dirname, 'uploads', processedFilename);
        fs.writeFileSync(processedPath, processedFbxData);

        console.log('FBX processing complete:', processedFilename);

        res.json({
            success: true,
            processedFilename: processedFilename,
            message: 'FBX processing complete with modified animation data applied'
        });

    } catch (error) {
        console.error('FBX processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download processed FBX
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, filename, (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(500).json({ error: 'Download failed' });
        }
    });
});

// FBX processing function with modified animation data
function applyModifiedAnimationData(fbxData, modifiedBoneData, animationData) {
    console.log('Applying modified animation data to FBX...');

    if (!modifiedBoneData || !modifiedBoneData.tracks) {
        console.log('No modified bone data provided, returning original FBX');
        return fbxData;
    }

    console.log('Modified animation tracks:', modifiedBoneData.tracks.length);
    console.log('Animation duration:', modifiedBoneData.duration);

    // Log some track information for debugging
    modifiedBoneData.tracks.slice(0, 5).forEach(track => {
        console.log(`- ${track.boneName}.${track.property}: ${track.values.length} values`);
    });

    try {
        console.log('🔄 Parsing FBX file...');

        // Parse the FBX file
        const fbxObject = FBXParser.parse(fbxData);
        console.log('✅ FBX parsed successfully');

        // Find animation stack/layer
        const animStacks = fbxObject.getByType('AnimationStack');
        if (!animStacks || animStacks.length === 0) {
            console.log('❌ No animation stacks found in FBX');
            return fbxData;
        }

        console.log('📊 Found', animStacks.length, 'animation stack(s)');

        // Get the first animation stack
        const animStack = animStacks[0];
        const animLayers = animStack.getByType('AnimationLayer');

        if (!animLayers || animLayers.length === 0) {
            console.log('❌ No animation layers found');
            return fbxData;
        }

        console.log('📊 Found', animLayers.length, 'animation layer(s)');

        // Process each modified track
        let modifiedCurves = 0;

        console.log('🔍 Available animation curves in FBX:');
        const animCurves = animLayers[0].getByType('AnimationCurve');
        const curveNodes = new Set();
        animCurves.forEach(curve => {
            const curveNode = curve.getParent();
            if (curveNode && curveNode.name) {
                curveNodes.add(curveNode.name);
            }
        });
        console.log('Curve nodes found:', Array.from(curveNodes).slice(0, 10)); // Show first 10

        modifiedBoneData.tracks.forEach(track => {
            try {
                // Find animation curves for this bone/property
                const animCurves = animLayers[0].getByType('AnimationCurve');

                animCurves.forEach(curve => {
                    const curveNode = curve.getParent();
                    if (curveNode && curveNode.name &&
                        (curveNode.name.includes(track.boneName) ||
                         track.boneName.includes(curveNode.name) ||
                         curveNode.name.replace(/[^a-zA-Z0-9]/g, '') === track.boneName.replace(/[^a-zA-Z0-9]/g, ''))) {
                        // Check various property identifiers in FBX
                        const properties = [
                            curve.getProperty('d|X'),
                            curve.getProperty('d|Y'),
                            curve.getProperty('d|Z'),
                            curve.getProperty('d|DeformPercent'),
                            curve.getProperty('d|Transform'),
                            curve.getProperty('d|Rotation'),
                            curve.getProperty('d|Translation'),
                            curve.getProperty('d|Scaling')
                        ].filter(p => p);

                        // Try to match any property with our track property
                        const matchingProperty = properties.find(prop => isPropertyMatch(track.property, prop));

                        if (matchingProperty) {
                            // Replace the curve data with our modified values
                            replaceCurveData(curve, track.times, track.values);
                            modifiedCurves++;
                            console.log(`✅ Modified ${track.boneName}.${track.property} (matched: ${matchingProperty})`);
                        } else {
                            console.log(`⚠️  No matching property found for ${track.boneName}.${track.property}. Available properties: ${properties.join(', ')}`);
                        }
                    }
                });
            } catch (trackError) {
                console.log(`⚠️  Error processing track ${track.boneName}.${track.property}:`, trackError.message);
            }
        });

        console.log(`🎉 Modified ${modifiedCurves} animation curves`);

        // Convert back to FBX binary format
        const modifiedFbxData = FBXParser.write(fbxObject);
        console.log('✅ FBX regenerated with modified animation data');

        return modifiedFbxData;

    } catch (error) {
        console.error('❌ FBX processing error:', error.message);
        console.log('⚠️  Falling back to original file due to processing error');
        return fbxData;
    }
}

// Helper function to get property name from FBX property
function getPropertyName(property) {
    if (property.includes('Translation') || property.includes('T')) return 'position';
    if (property.includes('Rotation') || property.includes('R')) return 'quaternion';
    if (property.includes('Scaling') || property.includes('S')) return 'scale';
    return '';
}

// Helper function to check if track property matches FBX property
function isPropertyMatch(trackProperty, fbxProperty) {
    // Direct mapping from Three.js property names to FBX property types
    const propertyMap = {
        'quaternion': ['Rotation', 'R'],
        'position': ['Translation', 'T'],
        'scale': ['Scaling', 'S']
    };

    if (propertyMap[trackProperty]) {
        return propertyMap[trackProperty].some(fbxProp => fbxProperty.includes(fbxProp));
    }

    return false;
}

// Helper function to replace curve data
function replaceCurveData(curve, times, values) {
    try {
        // Get the curve's key time and value arrays
        const keyTimes = curve.getProperty('KeyTime');
        const keyValues = curve.getProperty('KeyValueFloat');

        if (keyTimes && keyValues && times && values) {
            // Convert times to FBX time format (ticks)
            const fbxTimes = times.map(time => Math.floor(time * 46186158000)); // Convert to FBX time units

            // Replace the arrays
            curve.setProperty('KeyTime', fbxTimes);
            curve.setProperty('KeyValueFloat', values);

            // Update key count
            curve.setProperty('KeyCount', times.length);

            console.log(`  📊 Replaced ${times.length} keyframes`);
        }
    } catch (error) {
        console.log(`  ⚠️  Error replacing curve data: ${error.message}`);
    }
}

app.listen(PORT, () => {
    console.log(`FBX Processing Server running on http://localhost:${PORT}`);
    console.log('Upload endpoint: POST /upload-fbx');
    console.log('Process endpoint: POST /process-fbx');
    console.log('Download endpoint: GET /download/:filename');
});