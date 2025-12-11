// Initialisation Three.js
let scene, camera, renderer;
let sphere, sphereBaseRadius = 2;
let analyser, dataArray;
let audioReady = false;

let smoothedLevel = 0;

// seuil de parole (genre là si parle trop doucement il va pas le détécter, c'est pour éviter de bouger a cause des bruits legers d'arrière plan)
const SPEECH_THRESHOLD = 0.04;

function initThree() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);

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

	const ambient = new THREE.AmbientLight(0x202020);
	scene.add(ambient);

	const geometry = new THREE.SphereGeometry(sphereBaseRadius, 128, 128);
	const material = new THREE.MeshStandardMaterial({
		color: 0x00ffff,
		metalness: 0.9,
		roughness: 0.15,
		emissive: 0x000011,
		emissiveIntensity: 1.0
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
		analyser.fftSize = 2048; // un peu plus de détails
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
	const avg = sum / dataArray.length; // 0..255
	return avg / 255; // 0..1
}

// Animation
function animate() {
	requestAnimationFrame(animate);

	const rawLevel = getAudioLevel(); // 0..1

	// lissage : plus sensible aux montées qu'aux descentes
	const attack = 0.45;
	const release = 0.08;
	if (rawLevel > smoothedLevel) {
		smoothedLevel += (rawLevel - smoothedLevel) * attack;
	} else {
		smoothedLevel += (rawLevel - smoothedLevel) * release;
	}

	// utilise le niveau lissé comme base
	let boostedLevel = smoothedLevel;

	// clamp pour éviter les micro‑mouvements quand il n’y a presque rien
	if (boostedLevel < SPEECH_THRESHOLD) {
		boostedLevel = 0;
	} else {
		// on remap le niveau pour qu'à partir du seuil ça réagisse fort
		const norm = (boostedLevel - SPEECH_THRESHOLD) / (1 - SPEECH_THRESHOLD);
		boostedLevel = Math.min(1, norm * 1.6);
	}

	const time = performance.now() * 0.001;

	// SANS SON : sphère quasi parfaite, très peu de mouvement
	// AVEC SON : gonflement + déformation
	const idleScale = 1.0;
	const speakScale = 1.0 + boostedLevel * 2.0;
	const scale = idleScale * (1 - boostedLevel) + speakScale * boostedLevel;
	sphere.scale.set(scale, scale, scale);

	const geo = sphere.geometry;
	const position = geo.attributes.position;
	const vertex = new THREE.Vector3();

	if (boostedLevel === 0) {
		// PAS DE SON : on remet les sommets exactement sur une sphère
		for (let i = 0; i < position.count; i++) {
			vertex.fromBufferAttribute(position, i);
			vertex.normalize().multiplyScalar(sphereBaseRadius);
			position.setXYZ(i, vertex.x, vertex.y, vertex.z);
		}
		position.needsUpdate = true;
		geo.computeVertexNormals();
	} else {
		// QUAND ON PARLE : grosses déformations
		for (let i = 0; i < position.count; i++) {
			vertex.fromBufferAttribute(position, i);
			const noise =
				Math.sin(vertex.x * 5 + time * 6) *
				Math.cos(vertex.y * 5 + time * 4) *
				(0.1 + boostedLevel * 0.9); // bosses très visibles
			vertex.normalize().multiplyScalar(sphereBaseRadius + noise);
			position.setXYZ(i, vertex.x, vertex.y, vertex.z);
		}
		position.needsUpdate = true;
		geo.computeVertexNormals();
	}

	// rotation de base très lente
	let rotX = 0.002;
	let rotY = 0.005;

	// boost de rotation quand tu parles
	rotX += 0.04 * boostedLevel;
	rotY += 0.08 * boostedLevel;

	sphere.rotation.x += rotX;
	sphere.rotation.y += rotY;

	// changement de couleur / émission uniquement quand tu parles
	const mat = sphere.material;
	if (boostedLevel === 0) {
		// couleur "repos"
		mat.color.setRGB(0.0, 1.0, 1.0);
		mat.emissive.setRGB(0.0, 0.05, 0.1);
		mat.emissiveIntensity = 0.6;
	} else {
		// interpolation simple entre cyan et orange/rouge
		const r = 0x00 + Math.floor(0xff * boostedLevel);
		const g = 0xff - Math.floor(0x90 * boostedLevel);
		const b = 0xff - Math.floor(0xff * boostedLevel);
		mat.color.setRGB(r / 255, g / 255, b / 255);

		mat.emissive.setRGB((r / 255) * 0.7, (g / 255) * 0.3, (b / 255) * 0.7);
		mat.emissiveIntensity = 0.7 + boostedLevel * 2.5;
	}

	renderer.render(scene, camera);
}

// Lancement
initThree();
initAudio();
animate();
