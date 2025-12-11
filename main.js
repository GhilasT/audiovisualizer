// Initialisation Three.js
let scene, camera, renderer;
let sphere, sphereBaseRadius = 2;
let analyser, dataArray;
let audioReady = false;

let smoothedLevel = 0;
const SPEECH_THRESHOLD = 0.04;

function initThree() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0xf4f4f4);

	camera = new THREE.PerspectiveCamera(
		60,
		window.innerWidth / window.innerHeight,
		0.1,
		100
	);
	camera.position.set(0, 0, 8);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);

	const light = new THREE.PointLight(0xffffff, 1.8, 100);
	light.position.set(8, 8, 8);
	scene.add(light);

	const ambient = new THREE.AmbientLight(0x404040);
	scene.add(ambient);

	const geometry = new THREE.SphereGeometry(sphereBaseRadius, 128, 128);

	// --- Shader custom pour halo uniquement sur les bords ---
	const vertexShader = `
		varying vec3 vNormal;
		varying vec3 vWorldPosition;

		void main() {
			vNormal = normalize(normalMatrix * normal);
			vec4 worldPos = modelMatrix * vec4(position, 1.0);
			vWorldPosition = worldPos.xyz;
			gl_Position = projectionMatrix * viewMatrix * worldPos;
		}
	`;

	const fragmentShader = `
		uniform float uTime;
		uniform float uAudioLevel;
		uniform vec3 uBaseColor;
		uniform vec3 uEdgeColor;
		uniform vec3 uCameraPosition;

		varying vec3 vNormal;
		varying vec3 vWorldPosition;

		// conversion simple HSV -> RGB
		vec3 hsv2rgb(vec3 c) {
			vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
			vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
			return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
		}

		void main() {
			vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

			// rim = fort quand normale ~ perpendiculaire à vue (bords)
			float rim = 1.0 - abs(dot(normalize(vNormal), viewDir));
			rim = pow(clamp(rim, 0.0, 1.0), 2.0);

			// intensité contrôlée par l'audio, BOOSTÉE
			float intensity = rim * uAudioLevel * 2.5;

			// couleur dynamique type arc-en-ciel, plus saturée/brillante
			float hue = fract(uTime * 0.2 + uAudioLevel * 0.7);
			vec3 edgeCol = hsv2rgb(vec3(hue, 1.0, 1.4)); // V > 1 pour plus de punch

			// coeur sombre, halo très visible sur les bords
			vec3 base = uBaseColor;
			vec3 col = base + edgeCol * intensity;

			gl_FragColor = vec4(col, 1.0);
		}
	`;

	const material = new THREE.ShaderMaterial({
		vertexShader,
		fragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uAudioLevel: { value: 0 },
			uBaseColor: { value: new THREE.Color(0.02, 0.03, 0.05) },
			uEdgeColor: { value: new THREE.Color(1, 1, 1) },
			uCameraPosition: { value: new THREE.Vector3() }
		}
	});

	sphere = new THREE.Mesh(geometry, material);
	scene.add(sphere);

	window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

// Initialisation audio (micro)
async function initAudio() {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: true,
			video: false
		});

		const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		const source = audioCtx.createMediaStreamSource(stream);
		analyser = audioCtx.createAnalyser();
		analyser.fftSize = 2048;
		const bufferLength = analyser.frequencyBinCount;
		dataArray = new Uint8Array(bufferLength);

		source.connect(analyser);
		audioReady = true;
	} catch (err) {
		console.error('Erreur accès micro :', err);
		const info = document.getElementById('info');
		if (info) {
			info.textContent = 'Impossible d’accéder au micro : ' + err.message;
		}
	}
}

// Récupère une amplitude moyenne à partir du spectre
function getAudioLevel() {
	if (!audioReady || !analyser || !dataArray) return 0;
	analyser.getByteFrequencyData(dataArray);
	let sum = 0;
	for (let i = 0; i < dataArray.length; i++) {
		sum += dataArray[i];
	}
	const avg = sum / dataArray.length;
	return avg / 255;
}

// Animation
function animate() {
	requestAnimationFrame(animate);

	const rawLevel = getAudioLevel();

	const attack = 0.45;
	const release = 0.08;
	if (rawLevel > smoothedLevel) {
		smoothedLevel += (rawLevel - smoothedLevel) * attack;
	} else {
		smoothedLevel += (rawLevel - smoothedLevel) * release;
	}

	let boostedLevel = smoothedLevel;
	if (boostedLevel < SPEECH_THRESHOLD) {
		boostedLevel = 0;
	} else {
		const norm = (boostedLevel - SPEECH_THRESHOLD) / (1 - SPEECH_THRESHOLD);
		boostedLevel = Math.min(1, norm * 1.6);
	}

	const time = performance.now() * 0.001;

	const idleScale = 1.0;
	const speakScale = 1.0 + boostedLevel * 2.0;
	const scale = idleScale * (1 - boostedLevel) + speakScale * boostedLevel;
	sphere.scale.set(scale, scale, scale);

	const geo = sphere.geometry;
	const position = geo.attributes.position;
	const vertex = new THREE.Vector3();

	if (boostedLevel === 0) {
		for (let i = 0; i < position.count; i++) {
			vertex.fromBufferAttribute(position, i);
			vertex.normalize().multiplyScalar(sphereBaseRadius);
			position.setXYZ(i, vertex.x, vertex.y, vertex.z);
		}
		position.needsUpdate = true;
		geo.computeVertexNormals();
	} else {
		for (let i = 0; i < position.count; i++) {
			vertex.fromBufferAttribute(position, i);

			const base = Math.sin(vertex.x * 3.0 + time * 4.0) *
			             Math.cos(vertex.y * 3.5 + time * 3.0);

			const audioWave = Math.sin(vertex.x * 10.0 + time * 12.0) *
			                  Math.cos(vertex.y * 8.0 + time * 9.0);

			const noise = base * 0.05 + audioWave * (0.05 + boostedLevel * 0.25);

			vertex.normalize().multiplyScalar(sphereBaseRadius + noise);
			position.setXYZ(i, vertex.x, vertex.y, vertex.z);
		}
		position.needsUpdate = true;
		geo.computeVertexNormals();
	}

	let rotX = 0.002;
	let rotY = 0.005;
	rotX += 0.04 * boostedLevel;
	rotY += 0.08 * boostedLevel;
	sphere.rotation.x += rotX;
	sphere.rotation.y += rotY;

	// --- mise à jour des uniforms du shader pour halo sur les bords ---
	const mat = sphere.material;
	mat.uniforms.uTime.value = time;
	mat.uniforms.uAudioLevel.value = boostedLevel;
	mat.uniforms.uCameraPosition.value.copy(camera.position);

	renderer.render(scene, camera);
}

// Lancement
initThree();
initAudio();
animate();
