import * as THREE from "three";

export const createScene = () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#b8ddec");
  scene.fog = new THREE.FogExp2("#b8ddec", 0.009);

  const ambient = new THREE.HemisphereLight("#fff5dc", "#64715a", 2.15);
  ambient.name = "agency-ambient-light";
  scene.add(ambient);

  const sun = new THREE.DirectionalLight("#ffe5a6", 3.35);
  sun.name = "agency-sun-light";
  sun.position.set(42, 86, 26);
  sun.castShadow = false;
  scene.add(sun);

  return scene;
};
