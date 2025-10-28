import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

class ArmatureAnalyzer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.mixer = null;
        this.action = null;
        this.clock = new THREE.Clock();
        this.bones = [];
        this.skeleton = null;
        this.animationClip = null;
        this.isPlaying = false;
        this.animationSpeed = 1.0;
        this.frameData = [];
        this.loadedModel = null;
        this.boundsHelper = null;
        this.smoothRules = []; // Track selective smoothing rules

        this.init();
        this.setupEventListeners();
    }

    init() {
        const container = document.getElementById('viewer');

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a2a2a);

        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        this.scene.add(gridHelper);

        this.animate();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupEventListeners() {
        const fileInput = document.getElementById('fileInput');
        const playBtn = document.getElementById('playBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        const resetBtn = document.getElementById('resetBtn');
        const timeSlider = document.getElementById('timeSlider');
        const speedSlider = document.getElementById('speedSlider');
        const exportBtn = document.getElementById('exportBtn');
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        const addSmoothRuleBtn = document.getElementById('addSmoothRule');
        const setBoneLockBtn = document.getElementById('setBoneLockBtn');

        fileInput.addEventListener('change', (e) => this.loadFBX(e.target.files[0]));
        playBtn.addEventListener('click', () => this.playAnimation());
        pauseBtn.addEventListener('click', () => this.pauseAnimation());
        resetBtn.addEventListener('click', () => this.resetAnimation());
        timeSlider.addEventListener('input', (e) => this.seekAnimation(parseFloat(e.target.value)));
        speedSlider.addEventListener('input', (e) => this.setAnimationSpeed(parseFloat(e.target.value)));
        exportBtn.addEventListener('click', () => this.exportCleanedAnimation());
        exportJsonBtn.addEventListener('click', () => this.exportJsonForAI());
        addSmoothRuleBtn.addEventListener('click', () => this.addSmoothRule());
        setBoneLockBtn.addEventListener('click', () => this.setBoneLock());
    }

    async loadFBX(file) {
        if (!file) return;

        this.showLoading(true);

        try {
            const loader = new FBXLoader();
            const url = URL.createObjectURL(file);

            const fbx = await new Promise((resolve, reject) => {
                loader.load(url, resolve, undefined, reject);
            });

            console.log('=== FBX LOADED SUCCESSFULLY ===');
            console.log('FBX Object:', fbx);
            console.log('FBX Type:', fbx.type);
            console.log('FBX Name:', fbx.name);
            console.log('FBX Children Count:', fbx.children.length);
            console.log('FBX Position:', fbx.position);
            console.log('FBX Scale:', fbx.scale);
            console.log('FBX Rotation:', fbx.rotation);

            // Replace all materials immediately to prevent texture loading errors
            console.log('Replacing materials with simple materials (no textures)...');
            fbx.traverse((child) => {
                if (!child) {
                    console.warn('Encountered undefined child during material replacement');
                    return;
                }

                if (child.isMesh || child.isSkinnedMesh) {
                    try {
                        // Create simple material that doesn't require textures
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x808080,
                            roughness: 0.7,
                            metalness: 0.3,
                            side: THREE.DoubleSide,
                            skinning: child.isSkinnedMesh
                        });
                        console.log(`Replaced material for: ${child.name || 'unnamed'}`);
                    } catch (error) {
                        console.error(`Error replacing material for ${child.name}:`, error);
                    }
                }
            });

            this.clearScene();


            // Rotate the model 90 degrees on X-axis to make character stand upright
            fbx.rotation.x = -Math.PI / 2;

            // Scale down the model if it's too large
            this.normalizeModelSize(fbx);

            this.scene.add(fbx);
            this.loadedModel = fbx;

            // Comprehensive debugging
            this.debugFBXContents(fbx);

            // Fix materials and ensure mesh is visible
            this.fixMeshMaterials(fbx);

            // Position camera to view the model (after rotation)
            this.fitCameraToModel(fbx);

            this.extractBonesAndAnimation(fbx);
            this.setupBoneVisualization();

            URL.revokeObjectURL(url);
            this.showLoading(false);

        } catch (error) {
            console.error('Error loading FBX:', error);
            alert('Error loading FBX file. Please check the console for details.');
            this.showLoading(false);
        }
    }

    extractBonesAndAnimation(fbx) {
        this.bones = [];
        this.skeleton = null;
        this.animationClip = null;

        console.log('FBX object:', fbx);
        console.log('FBX children count:', fbx.children.length);

        // More comprehensive bone extraction
        fbx.traverse((child) => {
            console.log('Child type:', child.type, 'Name:', child.name, 'IsBone:', child.isBone, 'IsSkinnedMesh:', child.isSkinnedMesh);

            // Check for skinned mesh with skeleton
            if (child.isSkinnedMesh && child.skeleton) {
                console.log('Found skinned mesh with skeleton:', child.name);
                this.skeleton = child.skeleton;
                this.bones = child.skeleton.bones;
                console.log('Skeleton bones:', this.bones.length);
            }

            // Also check for bones directly
            if (child.isBone) {
                console.log('Found bone:', child.name);
                if (this.bones.indexOf(child) === -1) {
                    this.bones.push(child);
                }
            }

            // Check if this is a Group or Object3D that might contain bones
            if (child.type === 'Group' || child.type === 'Object3D') {
                console.log('Checking group/object3d:', child.name, 'Children:', child.children.length);
            }
        });

        // If no skeleton found but we have bones, create our own bone list
        if (!this.skeleton && this.bones.length === 0) {
            console.log('No skeleton found, searching for all bones in hierarchy...');
            fbx.traverse((child) => {
                if (child.isBone || child.type === 'Bone') {
                    this.bones.push(child);
                }
            });
        }

        // Handle animations
        if (fbx.animations && fbx.animations.length > 0) {
            console.log('Found animations:', fbx.animations.length);
            this.animationClip = fbx.animations[0];
            this.mixer = new THREE.AnimationMixer(fbx);
            this.action = this.mixer.clipAction(this.animationClip);

            const timeSlider = document.getElementById('timeSlider');
            timeSlider.max = this.animationClip.duration;
            timeSlider.disabled = false;

            document.getElementById('playBtn').disabled = false;
            document.getElementById('pauseBtn').disabled = false;
            document.getElementById('resetBtn').disabled = false;
            document.getElementById('exportBtn').disabled = false;
            document.getElementById('exportJsonBtn').disabled = false;
            document.getElementById('setBoneLockBtn').disabled = false;


            console.log('Animation duration:', this.animationClip.duration);
            console.log('Animation tracks:', this.animationClip.tracks.length);
        }

        this.updateBonesList();
        this.populateSmoothBoneDropdown();
        console.log(`Final bone count: ${this.bones.length}`);

        // Log the entire FBX structure for debugging
        this.logFBXStructure(fbx);
    }

    fixMeshMaterials(fbx) {
        console.log('Fixing mesh materials...');
        let meshCount = 0;

        fbx.traverse((child) => {
            // Safety check for undefined children
            if (!child) {
                console.warn('Encountered undefined child in fixMeshMaterials');
                return;
            }

            // More comprehensive mesh detection
            const hasMeshGeometry = child.geometry && (
                child.geometry.type === 'BufferGeometry' ||
                child.geometry.type === 'Geometry' ||
                child.geometry.attributes?.position
            );

            const isMeshLike = child.isMesh ||
                              child.isSkinnedMesh ||
                              (child.type === 'Mesh' && hasMeshGeometry) ||
                              (child.type === 'SkinnedMesh' && hasMeshGeometry) ||
                              hasMeshGeometry;

            if (isMeshLike) {
                meshCount++;
                console.log('Found mesh:', child.name, 'Type:', child.type);
                console.log('  Constructor:', child.constructor.name);
                console.log('  isMesh:', child.isMesh);
                console.log('  isSkinnedMesh:', child.isSkinnedMesh);
                console.log('  Geometry:', child.geometry ? child.geometry.type : 'None');
                console.log('  Position:', child.position);
                console.log('  Scale:', child.scale);
                console.log('  Rotation:', child.rotation);
                console.log('  Material:', child.material ? child.material.type : 'None');
                console.log('  Visible:', child.visible);

                if (child.geometry) {
                    console.log('  Vertex count:', child.geometry.attributes.position ? child.geometry.attributes.position.count : 'Unknown');
                    child.geometry.computeBoundingBox();
                    console.log('  Geometry bounds:', child.geometry.boundingBox);
                }

                // If this isn't already a proper mesh, convert it
                if (!child.isMesh && !child.isSkinnedMesh && hasMeshGeometry) {
                    console.log('  Converting to proper Mesh object...');

                    try {
                        // Validate child has required properties
                        if (!child.geometry) {
                            console.warn('  Child missing geometry, skipping conversion');
                            return;
                        }

                        // Create a new proper mesh with the geometry
                        const newMesh = child.skeleton ?
                            new THREE.SkinnedMesh(child.geometry, child.material) :
                            new THREE.Mesh(child.geometry, child.material);

                        // Copy transform
                        newMesh.position.copy(child.position);
                        newMesh.rotation.copy(child.rotation);
                        newMesh.scale.copy(child.scale);
                        newMesh.name = child.name + '_converted';

                        // Copy skeleton if it exists
                        if (child.skeleton) {
                            newMesh.bind(child.skeleton);
                        }

                        // Replace the child in the parent
                        if (child.parent) {
                            const parent = child.parent;
                            parent.add(newMesh);
                            parent.remove(child);
                            console.log('  Replaced mesh in parent hierarchy');
                        }
                    } catch (conversionError) {
                        console.error('  Error converting mesh:', conversionError);
                    }
                }

                // Ensure mesh is visible
                child.visible = true;
                child.castShadow = true;
                child.receiveShadow = true;

                // Create a simple GLB-compatible material (no textures needed)
                // Using MeshStandardMaterial for GLTFExporter compatibility
                const simpleMaterial = new THREE.MeshStandardMaterial({
                    color: 0x808080,  // Gray
                    roughness: 0.7,
                    metalness: 0.3,
                    side: THREE.DoubleSide,
                    skinning: child.isSkinnedMesh  // Enable skinning for animated meshes
                });

                // Apply the simple material immediately to prevent texture loading
                child.material = simpleMaterial;

                console.log('  Applied debug material');
            }
        });

        console.log(`Total meshes found and processed: ${meshCount}`);

        if (meshCount === 0) {
            console.warn('No meshes found! The FBX might contain only bones/armature.');
            // Let's check what we do have
            fbx.traverse((child) => {
                console.log(`Non-mesh object: ${child.type} - ${child.name}`);
            });
        }
    }

    fitCameraToModel(fbx) {
        // Calculate bounding box
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        console.log('Model bounds:', {
            min: box.min,
            max: box.max,
            size: size,
            center: center
        });

        // Check if bounding box is valid
        if (box.isEmpty()) {
            console.warn('Model has no bounding box! Using default camera position.');
            this.camera.position.set(5, 5, 5);
            this.camera.lookAt(0, 0, 0);
            this.controls.target.set(0, 0, 0);
            this.controls.update();
            return;
        }

        // Position camera to see the entire model
        const maxDim = Math.max(size.x, size.y, size.z);

        console.log('Model dimensions - Width:', size.x.toFixed(3), 'Height:', size.y.toFixed(3), 'Depth:', size.z.toFixed(3));
        console.log('Max dimension:', maxDim.toFixed(3));

        // Handle very small models (scale up view)
        if (maxDim < 0.001) {
            console.warn('Model is extremely small, adjusting camera for micro scale');
            this.camera.position.set(center.x + 0.01, center.y + 0.01, center.z + 0.01);
            this.camera.lookAt(center);
            this.controls.target.copy(center);
            this.controls.update();
            return;
        }

        // Handle large models more aggressively
        if (maxDim > 1000) {
            console.warn('Model is very large, using aggressive camera positioning');
            const scaledDistance = maxDim * 3; // Increased multiplier
            this.camera.position.set(center.x + scaledDistance, center.y + scaledDistance, center.z + scaledDistance);
            this.camera.lookAt(center);
            this.controls.target.copy(center);
            this.controls.update();
            return;
        }

        // For medium to large models
        if (maxDim > 100) {
            console.warn('Model is large, using increased camera distance');
            const scaledDistance = maxDim * 4; // Even more aggressive for large models
            this.camera.position.set(center.x + scaledDistance, center.y + scaledDistance, center.z + scaledDistance);
            this.camera.lookAt(center);
            this.controls.target.copy(center);
            this.controls.update();
            return;
        }

        const fov = this.camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2));

        // Add much more padding for rotated models
        cameraDistance *= 4.0; // Increased from 2.0 to 4.0

        // Position camera in a good viewing angle
        this.camera.position.set(
            center.x + cameraDistance,
            center.y + cameraDistance * 0.7,
            center.z + cameraDistance
        );
        this.camera.lookAt(center);
        this.controls.target.copy(center);
        this.controls.update();

        console.log('Camera positioned at:', this.camera.position);
        console.log('Looking at:', center);
        console.log('Distance from target:', this.camera.position.distanceTo(center));
    }


    normalizeModelSize(fbx) {
        // Calculate the model's bounding box
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        console.log('Original model size:', size);
        console.log('Original max dimension:', maxDim);

        // Target size - we want the model to be roughly 5 units tall/wide (grid is 10x10)
        const targetSize = 5;

        if (maxDim > targetSize) {
            const scaleFactor = targetSize / maxDim;
            fbx.scale.multiplyScalar(scaleFactor);

            console.log(`Model was too large (${maxDim.toFixed(2)} units)`);
            console.log(`Scaled down by factor of ${scaleFactor.toFixed(4)}`);
            console.log(`New max dimension should be: ${(maxDim * scaleFactor).toFixed(2)} units`);
        } else {
            console.log('Model size is acceptable, no scaling needed');
        }

        // Recalculate bounding box after scaling
        const newBox = new THREE.Box3().setFromObject(fbx);
        const newSize = newBox.getSize(new THREE.Vector3());
        console.log('Final model size:', newSize);
    }

    debugFBXContents(fbx) {
        console.log('=== COMPREHENSIVE FBX ANALYSIS ===');

        let totalObjects = 0;
        let meshes = 0;
        let skinnedMeshes = 0;
        let bones = 0;
        let groups = 0;
        let other = 0;

        fbx.traverse((child) => {
            totalObjects++;

            console.log(`Object ${totalObjects}: ${child.type} - "${child.name}"`);
            console.log(`  Constructor: ${child.constructor.name}`);
            console.log(`  Position: (${child.position.x.toFixed(3)}, ${child.position.y.toFixed(3)}, ${child.position.z.toFixed(3)})`);
            console.log(`  Scale: (${child.scale.x.toFixed(3)}, ${child.scale.y.toFixed(3)}, ${child.scale.z.toFixed(3)})`);
            console.log(`  Visible: ${child.visible}`);
            console.log(`  Parent: ${child.parent ? child.parent.name || child.parent.type : 'None'}`);
            console.log(`  Has geometry: ${!!child.geometry}`);
            console.log(`  Has material: ${!!child.material}`);
            console.log(`  isMesh: ${child.isMesh}`);
            console.log(`  isSkinnedMesh: ${child.isSkinnedMesh}`);
            console.log(`  isObject3D: ${child.isObject3D}`);
            console.log(`  isGroup: ${child.isGroup}`);
            console.log(`  Children count: ${child.children.length}`);

            // More comprehensive mesh detection
            const hasMeshGeometry = child.geometry && (
                child.geometry.type === 'BufferGeometry' ||
                child.geometry.type === 'Geometry' ||
                child.geometry.attributes?.position
            );

            if (child.isMesh || (child.type === 'Mesh' && hasMeshGeometry)) {
                meshes++;
                console.log(`  >>> MESH FOUND! <<<`);
                if (child.geometry) {
                    console.log(`  Geometry type: ${child.geometry.type}`);
                    console.log(`  Vertices: ${child.geometry.attributes.position ? child.geometry.attributes.position.count : 'Unknown'}`);
                    child.geometry.computeBoundingBox();
                    console.log(`  Bounding box: min(${child.geometry.boundingBox.min.x.toFixed(3)}, ${child.geometry.boundingBox.min.y.toFixed(3)}, ${child.geometry.boundingBox.min.z.toFixed(3)}) max(${child.geometry.boundingBox.max.x.toFixed(3)}, ${child.geometry.boundingBox.max.y.toFixed(3)}, ${child.geometry.boundingBox.max.z.toFixed(3)})`);
                }
                if (child.material) {
                    console.log(`  Material type: ${child.material.type}`);
                    console.log(`  Material visible: ${child.material.visible}`);
                }
            } else if (child.isSkinnedMesh || (child.type === 'SkinnedMesh' && hasMeshGeometry)) {
                skinnedMeshes++;
                console.log(`  >>> SKINNED MESH FOUND! <<<`);
                if (child.geometry) {
                    console.log(`  Geometry type: ${child.geometry.type}`);
                    console.log(`  Vertices: ${child.geometry.attributes.position ? child.geometry.attributes.position.count : 'Unknown'}`);
                    child.geometry.computeBoundingBox();
                    console.log(`  Bounding box: min(${child.geometry.boundingBox.min.x.toFixed(3)}, ${child.geometry.boundingBox.min.y.toFixed(3)}, ${child.geometry.boundingBox.min.z.toFixed(3)}) max(${child.geometry.boundingBox.max.x.toFixed(3)}, ${child.geometry.boundingBox.max.y.toFixed(3)}, ${child.geometry.boundingBox.max.z.toFixed(3)})`);
                }
                if (child.skeleton) {
                    console.log(`  Skeleton: ${child.skeleton.bones.length} bones`);
                }
            } else if (hasMeshGeometry) {
                // Check for objects that have mesh geometry but aren't marked as meshes
                console.log(`  >>> POTENTIAL MESH (has geometry but not marked as mesh)! <<<`);
                console.log(`  Object type: ${child.type}`);
                console.log(`  Constructor: ${child.constructor.name}`);
                if (child.geometry) {
                    console.log(`  Geometry type: ${child.geometry.type}`);
                    console.log(`  Vertices: ${child.geometry.attributes.position ? child.geometry.attributes.position.count : 'Unknown'}`);
                }
                other++;
            } else if (child.isBone || child.type === 'Bone') {
                bones++;
                console.log(`  >>> BONE FOUND! <<<`);
            } else if (child.type === 'Group') {
                groups++;
            } else {
                other++;
            }

            console.log('  ---');
        });

        console.log('=== SUMMARY ===');
        console.log(`Total objects: ${totalObjects}`);
        console.log(`Meshes: ${meshes}`);
        console.log(`Skinned meshes: ${skinnedMeshes}`);
        console.log(`Bones: ${bones}`);
        console.log(`Groups: ${groups}`);
        console.log(`Other: ${other}`);
        console.log('================');

        // EXTREME MESH HUNTING - Find ANY object with geometry
        console.log('🔍 EXTREME MESH HUNTING - SEARCHING FOR ANY GEOMETRY:');
        let geometryCount = 0;
        fbx.traverse((child) => {
            if (child.geometry) {
                geometryCount++;
                console.log(`🎯 GEOMETRY FOUND #${geometryCount}:`);
                console.log(`  Object: ${child.type} - "${child.name}"`);
                console.log(`  Constructor: ${child.constructor.name}`);
                console.log(`  Geometry type: ${child.geometry.type}`);
                console.log(`  Has position attribute: ${!!child.geometry.attributes?.position}`);
                if (child.geometry.attributes?.position) {
                    console.log(`  Vertex count: ${child.geometry.attributes.position.count}`);
                }
                console.log(`  Has normal attribute: ${!!child.geometry.attributes?.normal}`);
                console.log(`  Has UV attribute: ${!!child.geometry.attributes?.uv}`);
                console.log(`  Has index: ${!!child.geometry.index}`);
                if (child.geometry.index) {
                    console.log(`  Index count: ${child.geometry.index.count}`);
                }
                console.log(`  Material: ${child.material ? child.material.type : 'None'}`);
                console.log(`  Visible: ${child.visible}`);
                console.log(`  World Matrix:`, child.matrixWorld.elements.slice(0, 4));

                // Force this to be a mesh if it has geometry
                if (!child.isMesh && !child.isSkinnedMesh) {
                    console.log(`  ⚠️ CONVERTING TO MESH!`);
                    Object.defineProperty(child, 'isMesh', { value: true, writable: false });
                    meshes++; // Add to mesh count
                }
            }
        });

        console.log(`🎯 Total objects with geometry found: ${geometryCount}`);

        // ADDITIONAL: Check for FBX-specific patterns
        console.log('🔍 CHECKING FOR FBX-SPECIFIC PATTERNS:');
        fbx.traverse((child) => {
            // Check for objects that might be FBX model nodes
            if (child.name && (child.name.toLowerCase().includes('model') ||
                              child.name.toLowerCase().includes('mesh') ||
                              child.name.toLowerCase().includes('geometry'))) {
                console.log(`📋 Potential model object: ${child.type} - "${child.name}"`);
                console.log(`  Children: ${child.children.length}`);
                console.log(`  Has geometry: ${!!child.geometry}`);
                console.log(`  Has material: ${!!child.material}`);
            }

            // Check for unusual object types
            if (!['Group', 'Object3D', 'Bone', 'Mesh', 'SkinnedMesh'].includes(child.type)) {
                console.log(`🤔 Unusual object type: ${child.type} - "${child.name}"`);
                console.log(`  Constructor: ${child.constructor.name}`);
                console.log(`  Has geometry: ${!!child.geometry}`);
                console.log(`  Properties:`, Object.keys(child).filter(key => !key.startsWith('_')));
            }
        });

        if (meshes === 0 && skinnedMeshes === 0 && geometryCount === 0) {
            console.error('❌ NO MESHES OR GEOMETRY FOUND IN FBX! This FBX might contain only armature/bones.');
            console.log('🔧 Creating visual representation for bone structure...');
            this.createBoneVisualization();
            alert('No mesh geometry found in this FBX file. It appears to contain only bones/armature data.\n\nI\'ve created a visual representation of the bone structure for you to analyze.');
        } else if (geometryCount > 0) {
            console.log(`✅ Found ${geometryCount} objects with geometry! Attempting to force-render them...`);
            this.forceRenderGeometry(fbx);
        }
    }

    forceRenderGeometry(fbx) {
        console.log('💪 FORCE RENDERING ALL GEOMETRY...');

        fbx.traverse((child) => {
            if (child.geometry && child.geometry.attributes?.position) {
                console.log(`🔧 Processing geometry on: ${child.type} - "${child.name}"`);

                // Ensure it has a material
                if (!child.material) {
                    child.material = new THREE.MeshPhongMaterial({
                        color: 0xff6600,
                        side: THREE.DoubleSide,
                        wireframe: false
                    });
                    console.log('  ✅ Added missing material');
                }

                // Ensure it's visible
                child.visible = true;
                child.castShadow = true;
                child.receiveShadow = true;

                // If it's not a mesh, make it one
                if (!child.isMesh && !child.isSkinnedMesh) {
                    // Try to convert it to a mesh
                    const originalGeometry = child.geometry;
                    const originalMaterial = child.material;

                    // Create a new mesh with this geometry
                    const forcedMesh = new THREE.Mesh(originalGeometry, originalMaterial);
                    forcedMesh.name = child.name + '_forced_mesh';
                    forcedMesh.position.copy(child.position);
                    forcedMesh.rotation.copy(child.rotation);
                    forcedMesh.scale.copy(child.scale);
                    forcedMesh.visible = true;

                    // Add it to the same parent
                    if (child.parent) {
                        child.parent.add(forcedMesh);
                        console.log(`  ✅ Created forced mesh: ${forcedMesh.name}`);
                    }
                }

                console.log(`  ✅ Processed geometry`);
            }
        });
    }

    logFBXStructure(object, depth = 0) {
        const indent = '  '.repeat(depth);
        console.log(`${indent}${object.type}: "${object.name}" (${object.children.length} children)`);

        if (object.material) {
            console.log(`${indent}  Material: ${object.material.type || 'Unknown'}`);
        }
        if (object.geometry) {
            console.log(`${indent}  Geometry: ${object.geometry.type || 'Unknown'}`);
        }
        if (object.skeleton) {
            console.log(`${indent}  Skeleton: ${object.skeleton.bones.length} bones`);
        }

        if (depth < 3) { // Limit depth to prevent too much output
            object.children.forEach(child => {
                this.logFBXStructure(child, depth + 1);
            });
        }
    }

    createBoneVisualization() {
        if (this.bones.length === 0) {
            console.warn('No bones found to visualize');
            return;
        }

        console.log(`Creating visualization for ${this.bones.length} bones`);

        // Create bone spheres and connections
        const boneGroup = new THREE.Group();
        boneGroup.name = 'BoneVisualization';

        // Materials for visualization
        const boneMaterial = new THREE.MeshPhongMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.8
        });

        const rootBoneMaterial = new THREE.MeshPhongMaterial({
            color: 0xff0088,
            transparent: true,
            opacity: 0.9
        });

        const connectionMaterial = new THREE.LineBasicMaterial({
            color: 0x0088ff,
            linewidth: 3
        });

        // Create spheres for each bone
        this.bones.forEach((bone, index) => {
            // Create sphere for bone joint
            const sphereGeometry = new THREE.SphereGeometry(0.02, 8, 6);
            const isRoot = !bone.parent || !bone.parent.isBone;
            const sphere = new THREE.Mesh(sphereGeometry, isRoot ? rootBoneMaterial : boneMaterial);

            // Position sphere at bone's world position
            const worldPos = bone.getWorldPosition(new THREE.Vector3());
            sphere.position.copy(worldPos);
            sphere.name = `BoneSphere_${bone.name || index}`;
            boneGroup.add(sphere);

            // Create connection line to parent
            if (bone.parent && bone.parent.isBone) {
                const parentWorldPos = bone.parent.getWorldPosition(new THREE.Vector3());
                const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                    parentWorldPos,
                    worldPos
                ]);
                const line = new THREE.Line(lineGeometry, connectionMaterial);
                line.name = `BoneLine_${bone.name || index}`;
                boneGroup.add(line);
            }

            console.log(`Bone ${index}: "${bone.name}" at world position:`, worldPos);
        });

        // Add bone names as text sprites (simplified version)
        this.bones.forEach((bone, index) => {
            if (index % 2 === 0) { // Only show every other bone name to avoid clutter
                const worldPos = bone.getWorldPosition(new THREE.Vector3());
                const textGeometry = new THREE.PlaneGeometry(0.1, 0.02);
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 64;
                const context = canvas.getContext('2d');
                context.fillStyle = 'white';
                context.fillRect(0, 0, 256, 64);
                context.fillStyle = 'black';
                context.font = '16px Arial';
                context.fillText(bone.name || `Bone_${index}`, 10, 40);

                const texture = new THREE.CanvasTexture(canvas);
                const textMaterial = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    side: THREE.DoubleSide
                });
                const textMesh = new THREE.Mesh(textGeometry, textMaterial);
                textMesh.position.copy(worldPos);
                textMesh.position.y += 0.05; // Offset above bone
                textMesh.lookAt(this.camera.position);
                boneGroup.add(textMesh);
            }
        });

        this.scene.add(boneGroup);

        // Position camera to view the bone structure
        if (this.bones.length > 0) {
            const box = new THREE.Box3().setFromObject(boneGroup);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = maxDim * 2;

            this.camera.position.set(
                center.x + distance,
                center.y + distance * 0.7,
                center.z + distance
            );
            this.camera.lookAt(center);
            this.controls.target.copy(center);
            this.controls.update();

            console.log('Camera positioned to view bone structure');
            console.log('Bone structure bounds:', { center, size });
        }
    }

    setupBoneVisualization() {
        // Try to create skeleton helper even if we don't have a formal skeleton
        if (this.skeleton && this.skeleton.bones.length > 0) {
            const helper = new THREE.SkeletonHelper(this.skeleton.bones[0]);
            helper.material.color.setHex(0x00ff00);
            helper.material.linewidth = 2;
            this.scene.add(helper);
        } else if (this.bones.length > 0) {
            // Create skeleton helper from individual bones
            const helper = new THREE.SkeletonHelper(this.bones[0]);
            helper.material.color.setHex(0x00ff00);
            helper.material.linewidth = 2;
            this.scene.add(helper);
        }
    }

    updateBonesList() {
        const boneList = document.getElementById('boneList');
        const boneCount = document.getElementById('boneCount');

        boneCount.textContent = this.bones.length;
        boneList.innerHTML = '';

        this.bones.forEach((bone, index) => {
            const boneItem = document.createElement('div');
            boneItem.className = 'bone-item';
            boneItem.id = `bone-${index}`;

            const boneName = document.createElement('div');
            boneName.className = 'bone-name';
            boneName.textContent = bone.name || `Bone_${index}`;

            const boneTransform = document.createElement('div');
            boneTransform.className = 'bone-transform';
            boneTransform.id = `transform-${index}`;

            boneItem.appendChild(boneName);
            boneItem.appendChild(boneTransform);
            boneList.appendChild(boneItem);
        });

        this.updateBoneTransforms();
    }

    updateBoneTransforms() {
        this.bones.forEach((bone, index) => {
            const transformDiv = document.getElementById(`transform-${index}`);
            if (transformDiv) {
                const pos = bone.position;
                const rot = bone.rotation;
                const scale = bone.scale;

                transformDiv.innerHTML = `
                    Pos: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})<br>
                    Rot: (${rot.x.toFixed(3)}, ${rot.y.toFixed(3)}, ${rot.z.toFixed(3)})<br>
                    Scale: (${scale.x.toFixed(3)}, ${scale.y.toFixed(3)}, ${scale.z.toFixed(3)})
                `;
            }
        });
    }

    playAnimation() {
        if (this.action) {

            this.action.play();
            this.isPlaying = true;
        }
    }

    pauseAnimation() {
        if (this.action) {
            this.action.paused = true;
            this.isPlaying = false;
        }
    }

    resetAnimation() {
        if (this.action) {
            this.action.reset();
            this.action.paused = false;
            this.isPlaying = false;
            document.getElementById('timeSlider').value = 0;
            document.getElementById('timeDisplay').textContent = '0.00s';
        }
    }

    seekAnimation(time) {
        if (this.action && this.animationClip) {
            this.action.time = time;
            this.mixer.update(0);
            document.getElementById('timeDisplay').textContent = `${time.toFixed(2)}s`;
            this.updateBoneTransforms();
        }
    }

    setAnimationSpeed(speed) {
        this.animationSpeed = speed;
        if (this.action) {
            this.action.timeScale = speed;
        }
        document.getElementById('speedDisplay').textContent = `${speed.toFixed(1)}x`;
    }

    setBoneLock() {
        if (!this.animationClip || !this.bones.length) {
            alert('No animation data to apply bone locks');
            return;
        }

        if (this.smoothRules.length === 0) {
            alert('No control rules defined. Please add some rules first.');
            return;
        }

        console.log('🔒 Applying bone locks...');
        const status = document.getElementById('cleanupStatus');
        status.textContent = 'Applying bone locks...';

        // Apply selective smoothing rules
        const totalSmoothingApplied = this.applySelectiveSmoothing();

        // Update status
        status.textContent = `✅ Bone locks applied! Applied ${totalSmoothingApplied} smoothing operations across ${this.smoothRules.length} control rules.`;

        console.log(`🎉 Bone locks complete! Applied ${totalSmoothingApplied} operations.`);

        // Refresh the animation to show changes
        if (this.action) {
            this.action.time = this.action.time; // Force refresh
            this.mixer.update(0);
        }
    }


    captureFrameData() {
        if (!this.bones.length || !this.action) return;

        const frameData = {
            time: this.action.time,
            bones: this.bones.map(bone => ({
                name: bone.name || 'Unnamed',
                position: {
                    x: bone.position.x,
                    y: bone.position.y,
                    z: bone.position.z
                },
                rotation: {
                    x: bone.rotation.x,
                    y: bone.rotation.y,
                    z: bone.rotation.z
                },
                scale: {
                    x: bone.scale.x,
                    y: bone.scale.y,
                    z: bone.scale.z
                },
                quaternion: {
                    x: bone.quaternion.x,
                    y: bone.quaternion.y,
                    z: bone.quaternion.z,
                    w: bone.quaternion.w
                }
            }))
        };

        return frameData;
    }

    getHandWristFingerBones() {
        // Filter bones that commonly spazz out in mocap
        const problemBonePatterns = [
            // Hands and fingers
            /hand/i, /finger/i, /thumb/i, /index/i, /middle/i, /ring/i, /pinky/i,
            // Wrists
            /wrist/i,
            // Arms (can also have jitter)
            /arm/i, /forearm/i, /elbow/i,
            // Common naming patterns
            /\.(hand|wrist|finger|thumb)/i,
            /_hand/i, /_wrist/i, /_finger/i,
            /hand\./i, /wrist\./i, /finger\./i
        ];

        return this.bones.filter(bone => {
            const name = bone.name.toLowerCase();
            return problemBonePatterns.some(pattern => pattern.test(name));
        });
    }

    getFingerBoneType(boneName) {
        const name = boneName.toLowerCase();

        // Check if it's a metacarpal
        if (name.includes('metacarp') || name.includes('meta')) {
            return 'metacarpal';
        }

        // Check for finger bone segments by common patterns
        // Common patterns: finger1, finger2, finger3, thumb1, thumb2, etc.
        // Or: index_01, index_02, middle_01, etc.
        // Or: proximal, middle, distal

        const segmentPatterns = [
            // Numbered segments
            { pattern: /[._]?0?1$|[._]?01$|[._]?proximal/i, type: 'proximal' },
            { pattern: /[._]?0?2$|[._]?02$|[._]?middle/i, type: 'middle' },
            { pattern: /[._]?0?3$|[._]?03$|[._]?distal|[._]?tip/i, type: 'distal' },
            // Alternative patterns
            { pattern: /[._]?a$|[._]first/i, type: 'proximal' },
            { pattern: /[._]?b$|[._]second/i, type: 'middle' },
            { pattern: /[._]?c$|[._]third/i, type: 'distal' }
        ];

        for (const seg of segmentPatterns) {
            if (seg.pattern.test(name)) {
                return seg.type;
            }
        }

        // If no specific segment found but contains finger/thumb keywords, assume proximal
        if (name.includes('finger') || name.includes('thumb') ||
            name.includes('index') || name.includes('middle') ||
            name.includes('ring') || name.includes('pinky')) {
            return 'proximal'; // Default to proximal if unsure
        }

        return 'unknown';
    }

    getConservativeHumanoidConstraints(boneName) {
        const name = boneName.toLowerCase();


        // EXTREMELY PERMISSIVE CONSTRAINTS for everything else - Only prevent the absolute worst cases

        // FINGERS - Only prevent severe backward hyperextension
        if (name.match(/(thumb|index|middle|ring|pinky)_0[1-3]_[lr]/)) {
            return {
                x: { min: -Math.PI/3, max: Math.PI*7/4 },   // -60° to +315° - extremely permissive
                y: { min: -Math.PI, max: Math.PI },         // ±180° - essentially unlimited
                z: { min: -Math.PI, max: Math.PI }          // ±180° - essentially unlimited
            };
        }

        // ELBOWS/KNEES - Only prevent extreme hyperextension
        if (name.match(/^lowerarm_[lr]$/) || name.match(/^calf_[lr]$/)) {
            return {
                x: { min: -Math.PI/2, max: Math.PI*7/4 },   // -90° to +315° - extremely permissive
                y: { min: -Math.PI, max: Math.PI },         // ±180° - unlimited
                z: { min: -Math.PI, max: Math.PI }          // ±180° - unlimited
            };
        }

        // EVERYTHING ELSE - Almost no constraints, just prevent full 360° impossible rotations
        return {
            x: { min: -Math.PI*7/8, max: Math.PI*7/8 },     // ±157.5° - extremely generous
            y: { min: -Math.PI*7/8, max: Math.PI*7/8 },     // ±157.5° - extremely generous
            z: { min: -Math.PI*7/8, max: Math.PI*7/8 }      // ±157.5° - extremely generous
        };
    }

    getFingerConstraints(boneType) {
        // Legacy method - redirect to UE5 constraints
        return this.getUE5HumanoidConstraints('finger_01'); // Default finger constraint
    }

    getFingerBonesOnly() {
        // Filter to only actual finger bones (exclude arms, wrists, etc.)
        const fingerOnlyPatterns = [
            // Fingers and thumbs only
            /finger/i, /thumb/i, /index/i, /middle/i, /ring/i, /pinky/i,
            // Metacarpals
            /metacarp/i, /meta/i,
            // Common finger naming patterns
            /\.(finger|thumb)/i,
            /_finger/i, /_thumb/i,
            /finger\./i, /thumb\./i
        ];

        // Exclude arm/wrist bones specifically
        const excludePatterns = [
            /arm/i, /forearm/i, /elbow/i, /shoulder/i
        ];

        return this.bones.filter(bone => {
            const name = bone.name.toLowerCase();

            // Must match finger patterns
            const matchesFingerPattern = fingerOnlyPatterns.some(pattern => pattern.test(name));

            // Must not match exclude patterns
            const matchesExcludePattern = excludePatterns.some(pattern => pattern.test(name));

            return matchesFingerPattern && !matchesExcludePattern;
        });
    }

    getWristHandBones() {
        // Filter to only wrist and hand bones
        const wristHandPatterns = [
            /wrist/i, /hand$/i, /hand\./i, /_hand$/i
        ];

        // Exclude finger bones and arms
        const excludePatterns = [
            /finger/i, /thumb/i, /index/i, /middle/i, /ring/i, /pinky/i,
            /metacarp/i, /meta/i, /arm/i, /forearm/i, /elbow/i, /shoulder/i
        ];

        return this.bones.filter(bone => {
            const name = bone.name.toLowerCase();

            // Must match wrist/hand patterns
            const matchesWristHandPattern = wristHandPatterns.some(pattern => pattern.test(name));

            // Must not match exclude patterns
            const matchesExcludePattern = excludePatterns.some(pattern => pattern.test(name));

            return matchesWristHandPattern && !matchesExcludePattern;
        });
    }

    getIKHandBones() {
        // Filter to only IK hand bones
        const ikHandPatterns = [
            /ik.*hand/i, /hand.*ik/i, /ik_hand/i, /hand_ik/i,
            /ikhand/i, /handik/i, /_ik.*hand/i, /_hand.*ik/i
        ];

        // Exclude finger bones and arms
        const excludePatterns = [
            /finger/i, /thumb/i, /index/i, /middle/i, /ring/i, /pinky/i,
            /metacarp/i, /meta/i, /arm/i, /forearm/i, /elbow/i, /shoulder/i
        ];

        return this.bones.filter(bone => {
            const name = bone.name.toLowerCase();

            // Must match IK hand patterns
            const matchesIKHandPattern = ikHandPatterns.some(pattern => pattern.test(name));

            // Must not match exclude patterns
            const matchesExcludePattern = excludePatterns.some(pattern => pattern.test(name));

            return matchesIKHandPattern && !matchesExcludePattern;
        });
    }

    constrainWristHandRotations() {
        if (!this.animationClip) {
            console.log('No animation clip to constrain');
            return 0;
        }

        let constraintsApplied = 0;
        const wristHandBones = this.getWristHandBones();

        console.log(`🤲 Applying wrist/hand constraints to ${wristHandBones.length} wrist/hand bones...`);

        // Wrist and hand constraints - 10 degrees on all axes
        const wristHandConstraints = {
            x: { min: -Math.PI/18, max: Math.PI/18 }, // ±10 degrees
            y: { min: -Math.PI/18, max: Math.PI/18 }, // ±10 degrees
            z: { min: -Math.PI/18, max: Math.PI/18 }  // ±10 degrees
        };

        wristHandBones.forEach(bone => {
            console.log(`Constraining wrist/hand: ${bone.name}`);

            // Find rotation track for this bone
            const rotationTrackName = bone.name + '.quaternion';
            const rotTrack = this.animationClip.tracks.find(track => track.name === rotationTrackName);

            if (rotTrack) {
                const constraintsFixed = this.applyRotationConstraints(rotTrack, wristHandConstraints);
                constraintsApplied += constraintsFixed;
                console.log(`  Applied ${constraintsFixed} wrist/hand constraints to ${bone.name}`);
            }
        });

        console.log(`🤲 Total wrist/hand constraints applied: ${constraintsApplied}`);
        return constraintsApplied;
    }

    constrainIKHandRotations() {
        if (!this.animationClip) {
            console.log('No animation clip to constrain');
            return 0;
        }

        let constraintsApplied = 0;
        const ikHandBones = this.getIKHandBones();

        console.log(`🎯 Applying IK hand constraints to ${ikHandBones.length} IK hand bones...`);

        // IK hand constraints - no negative rotations, limited positive rotations
        const ikHandConstraints = {
            x: { min: 0, max: Math.PI/18 }, // 0 to +10 degrees (no negative)
            y: { min: 0, max: Math.PI/18 }, // 0 to +10 degrees (no negative)
            z: { min: 0, max: Math.PI/18 }  // 0 to +10 degrees (no negative)
        };

        ikHandBones.forEach(bone => {
            console.log(`Constraining IK hand: ${bone.name}`);

            // Find rotation track for this bone
            const rotationTrackName = bone.name + '.quaternion';
            const rotTrack = this.animationClip.tracks.find(track => track.name === rotationTrackName);

            if (rotTrack) {
                const constraintsFixed = this.applyRotationConstraints(rotTrack, ikHandConstraints);
                constraintsApplied += constraintsFixed;
                console.log(`  Applied ${constraintsFixed} IK hand constraints to ${bone.name}`);
            }
        });

        console.log(`🎯 Total IK hand constraints applied: ${constraintsApplied}`);
        return constraintsApplied;
    }

    constrainUE5HumanoidRotations() {
        if (!this.animationClip) {
            console.log('No animation clip to constrain');
            return 0;
        }

        let constraintsApplied = 0;
        console.log(`🤖 Applying conservative humanoid constraints to ${this.bones.length} bones...`);

        this.bones.forEach(bone => {
            const constraints = this.getConservativeHumanoidConstraints(bone.name);

            // Find rotation track for this bone
            const rotationTrackName = bone.name + '.quaternion';
            const rotTrack = this.animationClip.tracks.find(track => track.name === rotationTrackName);

            if (rotTrack) {
                const constraintsFixed = this.applyRotationConstraints(rotTrack, constraints);
                constraintsApplied += constraintsFixed;
                if (constraintsFixed > 0) {
                    console.log(`  Applied ${constraintsFixed} constraints to ${bone.name}`);
                }
            }
        });

        console.log(`🤖 Total conservative humanoid constraints applied: ${constraintsApplied}`);
        return constraintsApplied;
    }

    constrainFingerRotations() {
        // Legacy method for backwards compatibility
        return 0; // Now handled by constrainUE5HumanoidRotations
    }

    applyRotationConstraints(track, constraints) {
        let constraintsApplied = 0;
        const quaternions = track.values;
        const minRotationThreshold = Math.PI / 36; // 5 degrees in radians

        // First pass: find the maximum rotation on each axis across all keyframes
        let maxRotations = { x: 0, y: 0, z: 0 };

        for (let i = 0; i < quaternions.length; i += 4) {
            const quat = new THREE.Quaternion(
                quaternions[i],
                quaternions[i + 1],
                quaternions[i + 2],
                quaternions[i + 3]
            );

            const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
            maxRotations.x = Math.max(maxRotations.x, Math.abs(euler.x));
            maxRotations.y = Math.max(maxRotations.y, Math.abs(euler.y));
            maxRotations.z = Math.max(maxRotations.z, Math.abs(euler.z));
        }

        // Second pass: ONLY modify keyframes that violate constraints
        for (let i = 0; i < quaternions.length; i += 4) {
            const quat = new THREE.Quaternion(
                quaternions[i],     // x
                quaternions[i + 1], // y
                quaternions[i + 2], // z
                quaternions[i + 3]  // w
            );

            // Convert to Euler angles for constraint checking
            const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
            let modified = false;

            // Eliminate small rotations - if max rotation on an axis is less than 5 degrees, zero it out
            if (maxRotations.x < minRotationThreshold) {
                if (Math.abs(euler.x) > 0.001) { // Only modify if not already near zero
                    euler.x = 0;
                    modified = true;
                }
            }
            if (maxRotations.y < minRotationThreshold) {
                if (Math.abs(euler.y) > 0.001) { // Only modify if not already near zero
                    euler.y = 0;
                    modified = true;
                }
            }
            if (maxRotations.z < minRotationThreshold) {
                if (Math.abs(euler.z) > 0.001) { // Only modify if not already near zero
                    euler.z = 0;
                    modified = true;
                }
            }

            // ONLY apply constraints to rotations that actually violate them
            if (maxRotations.x >= minRotationThreshold) {
                if (euler.x < constraints.x.min) {
                    euler.x = constraints.x.min;
                    modified = true;
                } else if (euler.x > constraints.x.max) {
                    euler.x = constraints.x.max;
                    modified = true;
                }
            }

            if (maxRotations.y >= minRotationThreshold) {
                if (euler.y < constraints.y.min) {
                    euler.y = constraints.y.min;
                    modified = true;
                } else if (euler.y > constraints.y.max) {
                    euler.y = constraints.y.max;
                    modified = true;
                }
            }

            if (maxRotations.z >= minRotationThreshold) {
                if (euler.z < constraints.z.min) {
                    euler.z = constraints.z.min;
                    modified = true;
                } else if (euler.z > constraints.z.max) {
                    euler.z = constraints.z.max;
                    modified = true;
                }
            }

            // ONLY convert back to quaternion if we actually modified something
            if (modified) {
                const constrainedQuat = new THREE.Quaternion().setFromEuler(euler);
                quaternions[i] = constrainedQuat.x;
                quaternions[i + 1] = constrainedQuat.y;
                quaternions[i + 2] = constrainedQuat.z;
                quaternions[i + 3] = constrainedQuat.w;
                constraintsApplied++;
            }
        }

        return constraintsApplied;
    }







    exportCleanedAnimation() {
        console.log('🔧 Exporting cleaned animation as GLB...');

        if (!this.animationClip || !this.bones.length || !this.loadedModel) {
            alert('No animation data to export');
            return;
        }

        console.log('📦 Starting GLB export...');
        const status = document.getElementById('cleanupStatus');
        status.textContent = 'Preparing GLB export...';

        try {
            // Use GLTFExporter to export the updated model with animation
            const exporter = new GLTFExporter();

            // Create a scene with just our model for export
            const exportScene = new THREE.Scene();

            console.log('=== EXPORT DIAGNOSTICS ===');
            console.log('Original model:', this.loadedModel);

            // IMPORTANT: Don't clone! Export the original model directly to preserve bone references
            // We'll update the animations array directly and restore it after export
            const originalAnimations = this.loadedModel.animations;

            // Set the cleaned animation
            if (this.animationClip) {
                this.loadedModel.animations = [this.animationClip];
                console.log('Set cleaned animation for export');
            }

            // Ensure all materials are GLB-compatible
            console.log('Ensuring GLB-compatible materials...');
            const originalMaterials = new Map();

            this.loadedModel.traverse((child) => {
                if (!child) {
                    console.warn('Encountered undefined child during material check');
                    return;
                }

                if (child.isMesh || child.isSkinnedMesh) {
                    const oldMaterial = child.material;

                    // Save original material to restore later
                    originalMaterials.set(child, oldMaterial);

                    // Only convert if not already MeshStandardMaterial or MeshBasicMaterial
                    if (oldMaterial &&
                        oldMaterial.type !== 'MeshStandardMaterial' &&
                        oldMaterial.type !== 'MeshBasicMaterial') {

                        console.log(`Converting material for ${child.name}: ${oldMaterial.type} -> MeshStandardMaterial`);

                        child.material = new THREE.MeshStandardMaterial({
                            color: oldMaterial.color || 0x808080,
                            roughness: 0.7,
                            metalness: 0.3,
                            side: THREE.DoubleSide,
                            skinning: child.isSkinnedMesh
                        });
                    } else {
                        console.log(`Material OK for ${child.name}: ${oldMaterial?.type || 'none'}`);
                    }
                }
            });

            // Analyze what's in the model
            let skinnedMeshCount = 0;
            let meshCount = 0;
            let boneCount = 0;
            let skeletonInfo = [];

            this.loadedModel.traverse((child) => {
                if (child.isSkinnedMesh) {
                    skinnedMeshCount++;
                    console.log(`SkinnedMesh found: ${child.name}`);
                    console.log('  - Has geometry:', !!child.geometry);
                    console.log('  - Has material:', !!child.material);
                    console.log('  - Has skeleton:', !!child.skeleton);

                    if (child.skeleton) {
                        console.log('  - Skeleton bones:', child.skeleton.bones.length);
                        console.log('  - Skeleton boneInverses:', child.skeleton.boneInverses.length);
                        skeletonInfo.push({
                            mesh: child.name,
                            boneCount: child.skeleton.bones.length,
                            bones: child.skeleton.bones.map(b => b.name)
                        });
                    }
                } else if (child.isMesh) {
                    meshCount++;
                    console.log(`Regular Mesh found: ${child.name}`);
                } else if (child.isBone) {
                    boneCount++;
                }
            });

            console.log('\n=== MODEL STRUCTURE SUMMARY ===');
            console.log('SkinnedMeshes:', skinnedMeshCount);
            console.log('Regular Meshes:', meshCount);
            console.log('Bones:', boneCount);
            console.log('Skeleton Info:', JSON.stringify(skeletonInfo, null, 2));

            // Log animation data
            if (this.animationClip) {
                console.log('\n=== ANIMATION DATA ===');
                console.log('Animation name:', this.animationClip.name);
                console.log('Animation duration:', this.animationClip.duration);
                console.log('Animation tracks:', this.animationClip.tracks.length);
                console.log('Track details:');
                this.animationClip.tracks.forEach((track, i) => {
                    console.log(`  Track ${i}: ${track.name} (${track.ValueTypeName}, ${track.times.length} keyframes)`);
                });
            }

            // Add the model to export scene
            exportScene.add(this.loadedModel);

            console.log('\n=== EXPORT SCENE ===');
            console.log('Export scene children:', exportScene.children.length);
            console.log('Export scene animations:', this.loadedModel.animations ? this.loadedModel.animations.length : 0);

            // Export with animation
            const exportOptions = {
                binary: true,
                animations: this.loadedModel.animations || []
            };

            console.log('Export options:', exportOptions);
            console.log('Starting GLTFExporter.parse...\n');

            exporter.parse(
                exportScene,
                (gltfData) => {
                    // Success callback
                    console.log('\n=== GLB EXPORT SUCCESS ===');
                    console.log('GLB data type:', gltfData.constructor.name);
                    console.log('GLB data size:', gltfData.byteLength, 'bytes');
                    console.log('GLB data size (KB):', (gltfData.byteLength / 1024).toFixed(2), 'KB');

                    // Check if data looks valid (GLB header should start with 'glTF')
                    const headerView = new DataView(gltfData);
                    const magic = headerView.getUint32(0, true);
                    const version = headerView.getUint32(4, true);
                    const length = headerView.getUint32(8, true);

                    console.log('GLB Header:');
                    console.log('  Magic:', magic === 0x46546C67 ? '✓ Valid (glTF)' : '✗ Invalid');
                    console.log('  Version:', version);
                    console.log('  Length:', length);

                    if (gltfData.byteLength === 0) {
                        console.error('❌ GLB data is empty!');
                        alert('Export failed: GLB data is empty');
                        return;
                    }

                    // Parse and display the internal GLB structure
                    console.log('\n=== DETAILED GLB STRUCTURE ===');
                    const gltfJson = this.parseGLBStructure(gltfData);
                    if (gltfJson) {
                        console.log('\nFull GLTF JSON (for detailed inspection):');
                        console.log(JSON.stringify(gltfJson, null, 2));
                    }

                    const blob = new Blob([gltfData], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'cleaned_animation.glb';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    // Restore original state
                    console.log('\n=== RESTORING ORIGINAL STATE ===');

                    // Restore model to original scene
                    this.scene.add(this.loadedModel);

                    // Restore original animations
                    this.loadedModel.animations = originalAnimations;
                    console.log('Restored original animations');

                    // Restore original materials
                    originalMaterials.forEach((material, child) => {
                        child.material = material;
                    });
                    console.log('Restored original materials');

                    status.textContent = '✅ GLB exported successfully with cleaned animation data!';
                    console.log('📦 GLB export complete! File downloaded with cleaned animation data.');
                    console.log('✓ File can be imported into Blender, Maya, Unity, Unreal Engine, etc.');
                },
                (error) => {
                    // Error callback
                    console.error('\n=== GLB EXPORT ERROR ===');
                    console.error('Error message:', error.message);
                    console.error('Error stack:', error.stack);
                    console.error('Full error object:', error);

                    // Restore original state even on error
                    console.log('\n=== RESTORING ORIGINAL STATE (after error) ===');
                    this.scene.add(this.loadedModel);
                    this.loadedModel.animations = originalAnimations;
                    originalMaterials.forEach((material, child) => {
                        child.material = material;
                    });

                    status.textContent = `❌ GLB export failed: ${error.message}`;
                    alert(`GLB export failed: ${error.message}\n\nCheck browser console for details.`);
                },
                exportOptions
            );

        } catch (error) {
            console.error('Export error:', error);
            status.textContent = `❌ Export failed: ${error.message}`;
            alert(`Export failed: ${error.message}`);
        }
    }

    // Helper function to parse and display GLB structure for debugging
    parseGLBStructure(glbArrayBuffer) {
        try {
            const dataView = new DataView(glbArrayBuffer);

            // Read GLB header
            const magic = dataView.getUint32(0, true);
            const version = dataView.getUint32(4, true);
            const length = dataView.getUint32(8, true);

            console.log('GLB File Structure:');
            console.log('  Magic:', magic.toString(16), magic === 0x46546C67 ? '(valid glTF)' : '(INVALID!)');
            console.log('  Version:', version);
            console.log('  Total Length:', length);

            // Read first chunk (JSON)
            const chunk0Length = dataView.getUint32(12, true);
            const chunk0Type = dataView.getUint32(16, true);

            console.log('\nChunk 0 (JSON):');
            console.log('  Length:', chunk0Length);
            console.log('  Type:', chunk0Type === 0x4E4F534A ? 'JSON' : 'Unknown');

            // Extract and parse JSON
            const jsonBytes = new Uint8Array(glbArrayBuffer, 20, chunk0Length);
            const jsonString = new TextDecoder().decode(jsonBytes);
            const gltfJson = JSON.parse(jsonString);

            console.log('\nGLTF JSON Structure:');
            console.log('  Asset version:', gltfJson.asset?.version);
            console.log('  Scenes:', gltfJson.scenes?.length || 0);
            console.log('  Nodes:', gltfJson.nodes?.length || 0);
            console.log('  Meshes:', gltfJson.meshes?.length || 0);
            console.log('  Materials:', gltfJson.materials?.length || 0);
            console.log('  Skins:', gltfJson.skins?.length || 0);
            console.log('  Animations:', gltfJson.animations?.length || 0);
            console.log('  Accessors:', gltfJson.accessors?.length || 0);
            console.log('  BufferViews:', gltfJson.bufferViews?.length || 0);
            console.log('  Buffers:', gltfJson.buffers?.length || 0);

            if (gltfJson.animations && gltfJson.animations.length > 0) {
                console.log('\nAnimation Details:');
                gltfJson.animations.forEach((anim, i) => {
                    console.log(`  Animation ${i}: ${anim.name || 'unnamed'}`);
                    console.log(`    Channels: ${anim.channels?.length || 0}`);
                    console.log(`    Samplers: ${anim.samplers?.length || 0}`);
                });
            }

            if (gltfJson.skins && gltfJson.skins.length > 0) {
                console.log('\nSkin Details:');
                gltfJson.skins.forEach((skin, i) => {
                    console.log(`  Skin ${i}: ${skin.name || 'unnamed'}`);
                    console.log(`    Joints: ${skin.joints?.length || 0}`);
                    console.log(`    Skeleton root: ${skin.skeleton ?? 'none'}`);
                });
            }

            // Return the parsed JSON for further inspection
            return gltfJson;

        } catch (error) {
            console.error('Error parsing GLB structure:', error);
            return null;
        }
    }

    exportJsonForAI() {
        if (!this.animationClip || !this.bones.length) {
            alert('No animation data to export');
            return;
        }

        console.log('📦 Exporting JSON for AI training...');
        const status = document.getElementById('cleanupStatus');
        status.textContent = 'Preparing JSON export for AI training...';

        // Create export data optimized for AI training
        const exportData = {
            metadata: {
                name: 'AI Training Animation Data',
                originalFile: this.loadedModel.name || 'Unknown',
                duration: this.animationClip.duration,
                frameRate: 30,
                boneCount: this.bones.length,
                exportDate: new Date().toISOString(),
                modifications: [
                    'Processed for AI training',
                    'Contains bone hierarchy and animation tracks'
                ]
            },
            bones: this.bones.map((bone, index) => ({
                id: index,
                name: bone.name || `Bone_${index}`,
                parentId: bone.parent && this.bones.includes(bone.parent) ?
                         this.bones.indexOf(bone.parent) : -1
            })),
            animation: {
                tracks: this.animationClip.tracks.map(track => ({
                    name: track.name,
                    type: track.name.includes('.quaternion') ? 'rotation' :
                          track.name.includes('.position') ? 'position' : 'unknown',
                    times: [...track.times],
                    values: [...track.values],
                    interpolation: 'linear'
                }))
            }
        };

        // Export as JSON for AI training
        this.downloadJSON(exportData, 'animation_training_data.json');

        status.textContent = '✅ JSON exported for AI training! Contains animation data and bone hierarchy.';
        console.log('📦 JSON export complete! File optimized for AI training purposes.');
    }

    downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }












    getSmoothingParams(strength) {
        switch (strength) {
            case 'light':
                return {
                    detectionThreshold: 1.2, // Radians/second - how much change triggers smoothing
                    smoothingWindow: 3,      // Frames to average
                    smoothingStrength: 0.5   // How much to apply smoothing
                };
            case 'medium':
                return {
                    detectionThreshold: 1.0,
                    smoothingWindow: 4,
                    smoothingStrength: 0.7
                };
            case 'heavy':
                return {
                    detectionThreshold: 0.8,
                    smoothingWindow: 5,
                    smoothingStrength: 0.9
                };
            default:
                return this.getSmoothingParams('medium');
        }
    }

    smoothBoneAnimation(bone, params) {
        // Find the rotation track for this bone
        const rotationTrackName = bone.name + '.quaternion';
        const positionTrackName = bone.name + '.position';

        let issuesFixed = 0;

        // Smooth rotation track
        const rotTrack = this.animationClip.tracks.find(track => track.name === rotationTrackName);
        if (rotTrack) {
            issuesFixed += this.smoothTrackData(rotTrack, params, 'rotation');
        }

        // Smooth position track (less aggressive)
        const posTrack = this.animationClip.tracks.find(track => track.name === positionTrackName);
        if (posTrack) {
            const posParams = {...params, detectionThreshold: params.detectionThreshold * 2}; // Less sensitive for position
            issuesFixed += this.smoothTrackData(posTrack, posParams, 'position');
        }

        return issuesFixed;
    }

    smoothTrackData(track, params, type) {
        const { detectionThreshold, smoothingWindow, smoothingStrength } = params;
        const times = track.times;
        const values = track.values;
        const valueSize = type === 'rotation' ? 4 : 3; // quaternion vs vector3

        let issuesFixed = 0;

        // Detect and smooth rapid changes
        for (let i = 1; i < times.length - 1; i++) {
            const timeStep = times[i] - times[i - 1];
            if (timeStep <= 0) continue;

            // Calculate change rates
            const prevValueIndex = (i - 1) * valueSize;
            const currValueIndex = i * valueSize;
            const nextValueIndex = (i + 1) * valueSize;

            // Calculate velocity (change per second)
            let maxChange = 0;
            for (let j = 0; j < valueSize; j++) {
                const prevVal = values[prevValueIndex + j];
                const currVal = values[currValueIndex + j];
                const nextVal = values[nextValueIndex + j];

                const change1 = Math.abs(currVal - prevVal) / timeStep;
                const change2 = Math.abs(nextVal - currVal) / timeStep;

                maxChange = Math.max(maxChange, change1, change2);
            }

            // If change is above threshold, apply smoothing
            if (maxChange > detectionThreshold) {
                // Apply smoothing window
                const windowStart = Math.max(0, i - Math.floor(smoothingWindow / 2));
                const windowEnd = Math.min(times.length - 1, i + Math.floor(smoothingWindow / 2));

                // Calculate smoothed values
                for (let j = 0; j < valueSize; j++) {
                    let sum = 0;
                    let count = 0;

                    for (let k = windowStart; k <= windowEnd; k++) {
                        sum += values[k * valueSize + j];
                        count++;
                    }

                    const smoothedValue = sum / count;
                    const originalValue = values[currValueIndex + j];

                    // Blend original and smoothed based on smoothing strength
                    values[currValueIndex + j] = originalValue * (1 - smoothingStrength) +
                                                smoothedValue * smoothingStrength;
                }

                issuesFixed++;
            }
        }

        return issuesFixed;
    }


    clearScene() {
        // Remove only the FBX objects, keep lights and grid
        const objectsToRemove = [];
        this.scene.children.forEach(child => {
            if (child.type !== 'GridHelper' &&
                child.type !== 'AmbientLight' &&
                child.type !== 'DirectionalLight') {
                objectsToRemove.push(child);
            }
        });

        objectsToRemove.forEach(obj => {
            this.scene.remove(obj);
            if (obj.dispose) obj.dispose();
        });

        this.bones = [];
        this.skeleton = null;
        this.mixer = null;
        this.action = null;
        this.animationClip = null;

        document.getElementById('playBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = true;
        document.getElementById('resetBtn').disabled = true;
        document.getElementById('timeSlider').disabled = true;
        document.getElementById('exportBtn').disabled = true;
        document.getElementById('exportJsonBtn').disabled = true;
        document.getElementById('setBoneLockBtn').disabled = true;
    }


    populateSmoothBoneDropdown() {
        const select = document.getElementById('smoothBoneSelect');
        // Clear existing options except the first one
        select.innerHTML = '<option value="">-- Select Bone --</option>';

        // Add all bone names to the dropdown
        this.bones.forEach(bone => {
            const option = document.createElement('option');
            option.value = bone.name;
            option.textContent = bone.name;
            select.appendChild(option);
        });
    }

    addSmoothRule() {
        const boneSelect = document.getElementById('smoothBoneSelect');
        const startTimeInput = document.getElementById('startTime');
        const endTimeInput = document.getElementById('endTime');
        const intensitySelect = document.getElementById('smoothIntensity');

        const boneName = boneSelect.value;
        const startTime = parseFloat(startTimeInput.value);
        const endTime = parseFloat(endTimeInput.value);
        const intensity = intensitySelect.value;

        // Validation
        if (!boneName) {
            alert('Please select a bone to smooth');
            return;
        }

        if (isNaN(startTime) || isNaN(endTime)) {
            alert('Please enter valid start and end times');
            return;
        }

        if (startTime >= endTime) {
            alert('End time must be greater than start time');
            return;
        }

        if (this.animationClip && endTime > this.animationClip.duration) {
            alert(`End time cannot exceed animation duration (${this.animationClip.duration.toFixed(2)}s)`);
            return;
        }

        // Create smooth rule
        const rule = {
            id: Date.now(), // Simple unique ID
            boneName: boneName,
            startTime: startTime,
            endTime: endTime,
            intensity: intensity
        };

        // Add rule to array
        this.smoothRules.push(rule);

        // Update UI
        this.updateSmoothRulesList();

        // Reset form
        boneSelect.value = '';
        startTimeInput.value = '0';
        endTimeInput.value = '1';

        console.log(`Added smooth rule for ${boneName}: ${startTime}s - ${endTime}s (${intensity})`);
    }

    removeSmoothRule(ruleId) {
        this.smoothRules = this.smoothRules.filter(rule => rule.id !== ruleId);
        this.updateSmoothRulesList();
        console.log(`Removed smooth rule: ${ruleId}`);
    }

    updateSmoothRulesList() {
        const container = document.getElementById('smoothRulesList');

        if (this.smoothRules.length === 0) {
            container.innerHTML = '<span style="color: #888;">No smooth rules defined</span>';
            return;
        }

        container.innerHTML = '';
        this.smoothRules.forEach(rule => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin: 2px 0; padding: 3px 5px; background: #555; border-radius: 2px;';

            const infoSpan = document.createElement('span');
            infoSpan.innerHTML = `<span style="color: #4ecdc4; font-weight: bold;">${rule.boneName}</span>: ${rule.startTime}s - ${rule.endTime}s <span style="color: #feca57;">(${rule.intensity})</span>`;
            infoSpan.style.fontSize = '11px';

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.style.cssText = 'background: #d63031; border: none; color: white; border-radius: 2px; padding: 1px 5px; cursor: pointer; font-size: 12px;';
            removeBtn.onclick = () => this.removeSmoothRule(rule.id);

            item.appendChild(infoSpan);
            item.appendChild(removeBtn);
            container.appendChild(item);
        });
    }

    applySelectiveSmoothing() {
        if (!this.animationClip || this.smoothRules.length === 0) {
            return 0;
        }

        let totalSmoothingApplied = 0;
        console.log(`🎯 Applying ${this.smoothRules.length} selective smoothing rules...`);

        this.smoothRules.forEach(rule => {
            const bone = this.bones.find(b => b.name === rule.boneName);
            if (!bone) {
                console.warn(`Bone ${rule.boneName} not found`);
                return;
            }

            // Find rotation track for this bone
            const rotationTrackName = bone.name + '.quaternion';
            const rotTrack = this.animationClip.tracks.find(track => track.name === rotationTrackName);

            if (rotTrack) {
                const smoothingParams = this.getSmoothingParams(rule.intensity);
                const smoothingApplied = this.smoothTrackDataInTimeRange(rotTrack, smoothingParams, rule.startTime, rule.endTime, 'rotation', rule.intensity);
                totalSmoothingApplied += smoothingApplied;
                console.log(`  Applied ${smoothingApplied} smoothing operations to ${rule.boneName} (${rule.startTime}s - ${rule.endTime}s)`);
            }

            // Also smooth position track if it exists
            const positionTrackName = bone.name + '.position';
            const posTrack = this.animationClip.tracks.find(track => track.name === positionTrackName);

            if (posTrack) {
                const posParams = this.getSmoothingParams(rule.intensity);
                posParams.detectionThreshold *= 2; // Less sensitive for position
                const smoothingApplied = this.smoothTrackDataInTimeRange(posTrack, posParams, rule.startTime, rule.endTime, 'position', rule.intensity);
                totalSmoothingApplied += smoothingApplied;
            }
        });

        console.log(`🎯 Total selective smoothing operations: ${totalSmoothingApplied}`);
        return totalSmoothingApplied;
    }

    smoothTrackDataInTimeRange(track, params, startTime, endTime, type, intensity) {
        const times = track.times;
        const values = track.values;
        const valueSize = type === 'rotation' ? 4 : 3; // quaternion vs vector3
        let issuesFixed = 0;

        // Find time indices that fall within our range
        const startIndex = times.findIndex(time => time >= startTime);
        const endIndex = times.findIndex(time => time > endTime);

        const actualStartIndex = startIndex === -1 ? 0 : startIndex;
        const actualEndIndex = endIndex === -1 ? times.length : endIndex;

        if (actualStartIndex >= actualEndIndex) {
            return 0; // No keyframes in this time range
        }

        console.log(`    Smoothing ${track.name} from index ${actualStartIndex} to ${actualEndIndex} (${times[actualStartIndex]?.toFixed(2)}s - ${times[actualEndIndex - 1]?.toFixed(2)}s) - Intensity: ${intensity}`);

        // LOCK mode: Lock the bone by setting all values in range to the first value
        if (intensity === 'lock') {
            if (actualStartIndex < times.length) {
                // Get the first value in the range as our "locked" value
                const lockValueIndex = actualStartIndex * valueSize;
                const lockValues = [];
                for (let j = 0; j < valueSize; j++) {
                    lockValues[j] = values[lockValueIndex + j];
                }

                // Set all keyframes in the range to this locked value
                for (let i = actualStartIndex; i < actualEndIndex; i++) {
                    const currValueIndex = i * valueSize;
                    for (let j = 0; j < valueSize; j++) {
                        values[currValueIndex + j] = lockValues[j];
                    }
                    issuesFixed++;
                }

                console.log(`    LOCK: Locked ${actualEndIndex - actualStartIndex} keyframes to constant value`);
                return issuesFixed;
            }
        }

        // Regular smoothing for light/medium/heavy intensities
        if (intensity === 'heavy') {
            // HEAVY: Apply very strong smoothing to almost lock the bone
            const firstValueIndex = actualStartIndex * valueSize;
            const firstValues = [];
            for (let j = 0; j < valueSize; j++) {
                firstValues[j] = values[firstValueIndex + j];
            }

            // Set most keyframes to the first value, with slight variation
            for (let i = actualStartIndex; i < actualEndIndex; i++) {
                const currValueIndex = i * valueSize;
                for (let j = 0; j < valueSize; j++) {
                    const originalValue = values[currValueIndex + j];
                    // 95% towards first value, 5% original (barely moves)
                    values[currValueIndex + j] = firstValues[j] * 0.95 + originalValue * 0.05;
                }
                issuesFixed++;
            }
        } else if (intensity === 'medium') {
            // MEDIUM: Apply strong smoothing - significantly reduce movement
            const firstValueIndex = actualStartIndex * valueSize;
            const firstValues = [];
            for (let j = 0; j < valueSize; j++) {
                firstValues[j] = values[firstValueIndex + j];
            }

            // Set most keyframes towards first value, with more variation than heavy
            for (let i = actualStartIndex; i < actualEndIndex; i++) {
                const currValueIndex = i * valueSize;
                for (let j = 0; j < valueSize; j++) {
                    const originalValue = values[currValueIndex + j];
                    // 80% towards first value, 20% original (significantly reduced movement)
                    values[currValueIndex + j] = firstValues[j] * 0.8 + originalValue * 0.2;
                }
                issuesFixed++;
            }
        } else {
            // Light: Apply regular smoothing
            for (let i = actualStartIndex + 1; i < actualEndIndex - 1; i++) {
                const prevValueIndex = (i - 1) * valueSize;
                const currValueIndex = i * valueSize;
                const nextValueIndex = (i + 1) * valueSize;

                let hasLargeChange = false;

                // Check for large changes on any axis
                for (let j = 0; j < valueSize; j++) {
                    const prevVal = values[prevValueIndex + j];
                    const currVal = values[currValueIndex + j];
                    const nextVal = values[nextValueIndex + j];

                    // Calculate differences
                    const diff1 = Math.abs(currVal - prevVal);
                    const diff2 = Math.abs(nextVal - currVal);

                    // Detect jitter/spikes
                    if (diff1 > params.detectionThreshold || diff2 > params.detectionThreshold) {
                        hasLargeChange = true;
                        break;
                    }
                }

                // For medium, also apply smoothing more frequently
                const forceSmooth = intensity === 'medium' && Math.random() < 0.5;

                // If large change detected or force smoothing, apply smoothing
                if (hasLargeChange || forceSmooth) {
                    for (let j = 0; j < valueSize; j++) {
                        const prevVal = values[prevValueIndex + j];
                        const currVal = values[currValueIndex + j];
                        const nextVal = values[nextValueIndex + j];

                        // Apply smoothing with the specified strength
                        const smoothedValue = prevVal * 0.25 + currVal * 0.5 + nextVal * 0.25;
                        const originalValue = values[currValueIndex + j];

                        // Blend between original and smoothed based on strength
                        values[currValueIndex + j] = originalValue * (1 - params.smoothingStrength) +
                                                    smoothedValue * params.smoothingStrength;
                    }
                    issuesFixed++;
                }
            }
        }

        return issuesFixed;
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (this.mixer && this.isPlaying && !this.action.paused) {
            this.mixer.update(delta);

            if (this.action) {

                // Update UI
                const timeSlider = document.getElementById('timeSlider');
                timeSlider.value = this.action.time;
                document.getElementById('timeDisplay').textContent = `${this.action.time.toFixed(2)}s`;

                this.updateBoneTransforms();
            }
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    toggleWireframe(enabled) {
        if (!this.loadedModel) return;

        this.loadedModel.traverse((child) => {
            // Use same comprehensive mesh detection
            const hasMeshGeometry = child.geometry && (
                child.geometry.type === 'BufferGeometry' ||
                child.geometry.type === 'Geometry' ||
                child.geometry.attributes?.position
            );

            const isMeshLike = child.isMesh ||
                              child.isSkinnedMesh ||
                              (child.type === 'Mesh' && hasMeshGeometry) ||
                              (child.type === 'SkinnedMesh' && hasMeshGeometry) ||
                              hasMeshGeometry;

            if (isMeshLike && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        mat.wireframe = enabled;
                    });
                } else {
                    child.material.wireframe = enabled;
                }
            }
        });
    }

    toggleBounds(enabled) {
        if (enabled && this.loadedModel) {
            if (!this.boundsHelper) {
                const box = new THREE.Box3().setFromObject(this.loadedModel);
                this.boundsHelper = new THREE.Box3Helper(box, 0xffff00);
                this.scene.add(this.boundsHelper);
            }
        } else if (this.boundsHelper) {
            this.scene.remove(this.boundsHelper);
            this.boundsHelper = null;
        }
    }

    generateVerboseLog() {
        console.log('🔍 ================ ULTRA VERBOSE DEBUG LOG ================');
        console.log('🕐 Generated at:', new Date().toISOString());
        console.log('');

        // Scene analysis
        console.log('🏠 SCENE ANALYSIS:');
        console.log('Scene children count:', this.scene.children.length);
        console.log('Scene background:', this.scene.background);
        console.log('Scene fog:', this.scene.fog);
        console.log('');

        // Camera analysis
        console.log('📷 CAMERA ANALYSIS:');
        console.log('Position:', this.camera.position);
        console.log('Rotation:', this.camera.rotation);
        console.log('FOV:', this.camera.fov);
        console.log('Near/Far:', this.camera.near, '/', this.camera.far);
        console.log('Aspect:', this.camera.aspect);
        console.log('Matrix World:', this.camera.matrixWorld);
        console.log('');

        // Renderer analysis
        console.log('🖥️ RENDERER ANALYSIS:');
        console.log('Renderer size:', this.renderer.getSize(new THREE.Vector2()));
        console.log('Pixel ratio:', this.renderer.getPixelRatio());
        console.log('Shadow map enabled:', this.renderer.shadowMap.enabled);
        console.log('Auto clear:', this.renderer.autoClear);
        console.log('');

        // Loaded model analysis
        if (this.loadedModel) {
            console.log('📦 LOADED MODEL DEEP ANALYSIS:');
            this.analyzeObjectRecursive(this.loadedModel, 0);
        } else {
            console.log('❌ No loaded model found');
        }

        // Scene traversal
        console.log('🌳 COMPLETE SCENE TRAVERSAL:');
        this.scene.traverse((child, index) => {
            console.log(`Scene Child ${index}: ${child.type} - "${child.name}"`);
            console.log(`  UUID: ${child.uuid}`);
            console.log(`  Position: (${child.position.x}, ${child.position.y}, ${child.position.z})`);
            console.log(`  Scale: (${child.scale.x}, ${child.scale.y}, ${child.scale.z})`);
            console.log(`  Visible: ${child.visible}`);
            console.log(`  Layers: ${child.layers.mask}`);
            console.log(`  Frustum Culled: ${child.frustumCulled}`);
            console.log(`  Matrix Auto Update: ${child.matrixAutoUpdate}`);

            if (child.material) {
                this.analyzeMaterialVerbose(child.material);
            }

            if (child.geometry) {
                this.analyzeGeometryVerbose(child.geometry);
            }
            console.log('  ---');
        });

        // Bones analysis
        console.log('🦴 BONES DETAILED ANALYSIS:');
        if (this.bones.length > 0) {
            this.bones.forEach((bone, index) => {
                console.log(`Bone ${index}: "${bone.name}"`);
                console.log(`  Type: ${bone.type}`);
                console.log(`  Position: (${bone.position.x}, ${bone.position.y}, ${bone.position.z})`);
                console.log(`  Rotation: (${bone.rotation.x}, ${bone.rotation.y}, ${bone.rotation.z})`);
                console.log(`  Scale: (${bone.scale.x}, ${bone.scale.y}, ${bone.scale.z})`);
                console.log(`  World Position:`, bone.getWorldPosition(new THREE.Vector3()));
                console.log(`  Parent: ${bone.parent ? bone.parent.name : 'None'}`);
                console.log(`  Children: ${bone.children.length}`);
                console.log('  ---');
            });
        } else {
            console.log('No bones found');
        }

        console.log('🔍 ============= END ULTRA VERBOSE DEBUG LOG =============');
    }

    analyzeObjectRecursive(obj, depth = 0) {
        const indent = '  '.repeat(depth);
        console.log(`${indent}📋 Object: ${obj.type} - "${obj.name}"`);
        console.log(`${indent}   UUID: ${obj.uuid}`);
        console.log(`${indent}   Position: (${obj.position.x.toFixed(6)}, ${obj.position.y.toFixed(6)}, ${obj.position.z.toFixed(6)})`);
        console.log(`${indent}   Rotation: (${obj.rotation.x.toFixed(6)}, ${obj.rotation.y.toFixed(6)}, ${obj.rotation.z.toFixed(6)})`);
        console.log(`${indent}   Scale: (${obj.scale.x.toFixed(6)}, ${obj.scale.y.toFixed(6)}, ${obj.scale.z.toFixed(6)})`);
        console.log(`${indent}   Visible: ${obj.visible}`);
        console.log(`${indent}   Cast Shadow: ${obj.castShadow}`);
        console.log(`${indent}   Receive Shadow: ${obj.receiveShadow}`);
        console.log(`${indent}   Frustum Culled: ${obj.frustumCulled}`);
        console.log(`${indent}   Render Order: ${obj.renderOrder}`);
        console.log(`${indent}   Layers: ${obj.layers.mask}`);
        console.log(`${indent}   Matrix Auto Update: ${obj.matrixAutoUpdate}`);
        console.log(`${indent}   World Matrix:`, obj.matrixWorld.elements);

        if (obj.geometry) {
            console.log(`${indent}   🔺 HAS GEOMETRY!`);
            this.analyzeGeometryVerbose(obj.geometry, depth + 1);
        }

        if (obj.material) {
            console.log(`${indent}   🎨 HAS MATERIAL!`);
            this.analyzeMaterialVerbose(obj.material, depth + 1);
        }

        if (obj.skeleton) {
            console.log(`${indent}   🦴 HAS SKELETON! Bones: ${obj.skeleton.bones.length}`);
        }

        if (depth < 5) { // Prevent infinite recursion
            obj.children.forEach(child => {
                this.analyzeObjectRecursive(child, depth + 1);
            });
        }
    }

    analyzeMaterialVerbose(material, depth = 0) {
        const indent = '  '.repeat(depth);
        if (Array.isArray(material)) {
            console.log(`${indent}🎨 Material Array (${material.length} materials):`);
            material.forEach((mat, index) => {
                console.log(`${indent}  Material ${index}:`);
                this.analyzeSingleMaterial(mat, depth + 1);
            });
        } else {
            this.analyzeSingleMaterial(material, depth);
        }
    }

    analyzeSingleMaterial(material, depth = 0) {
        const indent = '  '.repeat(depth);
        console.log(`${indent}🎨 Material: ${material.type}`);
        console.log(`${indent}   UUID: ${material.uuid}`);
        console.log(`${indent}   Name: "${material.name}"`);
        console.log(`${indent}   Visible: ${material.visible}`);
        console.log(`${indent}   Side: ${material.side}`);
        console.log(`${indent}   Transparent: ${material.transparent}`);
        console.log(`${indent}   Opacity: ${material.opacity}`);
        console.log(`${indent}   Wireframe: ${material.wireframe}`);
        console.log(`${indent}   Depth Test: ${material.depthTest}`);
        console.log(`${indent}   Depth Write: ${material.depthWrite}`);
        if (material.color) {
            console.log(`${indent}   Color: rgb(${material.color.r}, ${material.color.g}, ${material.color.b})`);
        }
        if (material.map) {
            console.log(`${indent}   Has texture map: ${material.map.constructor.name}`);
        }
    }

    analyzeGeometryVerbose(geometry, depth = 0) {
        const indent = '  '.repeat(depth);
        console.log(`${indent}🔺 Geometry: ${geometry.type}`);
        console.log(`${indent}   UUID: ${geometry.uuid}`);
        console.log(`${indent}   Name: "${geometry.name}"`);

        if (geometry.attributes) {
            console.log(`${indent}   Attributes:`);
            Object.keys(geometry.attributes).forEach(key => {
                const attr = geometry.attributes[key];
                console.log(`${indent}     ${key}: ${attr.count} items, ${attr.itemSize} size, ${attr.array.constructor.name}`);
            });
        }

        if (geometry.index) {
            console.log(`${indent}   Index: ${geometry.index.count} indices`);
        }

        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        console.log(`${indent}   Bounding Box: min(${geometry.boundingBox.min.x.toFixed(6)}, ${geometry.boundingBox.min.y.toFixed(6)}, ${geometry.boundingBox.min.z.toFixed(6)}) max(${geometry.boundingBox.max.x.toFixed(6)}, ${geometry.boundingBox.max.y.toFixed(6)}, ${geometry.boundingBox.max.z.toFixed(6)})`);
        console.log(`${indent}   Bounding Sphere: center(${geometry.boundingSphere.center.x.toFixed(6)}, ${geometry.boundingSphere.center.y.toFixed(6)}, ${geometry.boundingSphere.center.z.toFixed(6)}) radius(${geometry.boundingSphere.radius.toFixed(6)})`);
    }

    inspectScene() {
        console.log('🔍 ================ SCENE INSPECTION ================');

        // Find all renderable objects
        const renderableObjects = [];
        this.scene.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh || child.isLine || child.isPoints) {
                renderableObjects.push(child);
            }
        });

        console.log(`Found ${renderableObjects.length} renderable objects in scene:`);

        renderableObjects.forEach((obj, index) => {
            console.log(`\n${index + 1}. ${obj.type} - "${obj.name}"`);
            console.log(`   Visible: ${obj.visible}`);
            console.log(`   In Scene: ${obj.parent !== null}`);
            console.log(`   Frustum Culled: ${obj.frustumCulled}`);

            // Check if object is within camera frustum
            const frustum = new THREE.Frustum();
            const matrix = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(matrix);

            const inFrustum = frustum.intersectsObject(obj);
            console.log(`   In Camera Frustum: ${inFrustum}`);

            // Calculate distance from camera
            const distance = this.camera.position.distanceTo(obj.position);
            console.log(`   Distance from Camera: ${distance.toFixed(6)}`);

            // Check layers
            console.log(`   Camera can see layers: ${this.camera.layers.mask}`);
            console.log(`   Object layers: ${obj.layers.mask}`);
            console.log(`   Layer intersection: ${(this.camera.layers.mask & obj.layers.mask) !== 0}`);
        });

        // Check renderer info
        console.log('\n🖥️ RENDERER INFO:');
        console.log('Renderer info:', this.renderer.info);

        console.log('\n📷 CAMERA MATRIX:');
        console.log('View Matrix:', this.camera.matrixWorldInverse.elements);
        console.log('Projection Matrix:', this.camera.projectionMatrix.elements);

        console.log('🔍 ============= END SCENE INSPECTION =============');
    }

    onWindowResize() {
        const container = document.getElementById('viewer');
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }
}

new ArmatureAnalyzer();