"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { HERO_END_YAW, roofProgress } from "@/components/cinematic/caveState";

const HERO_HEIGHT = 4.5;
const MODEL_PATH = "/models/hero/source/model.glb";
const HERO_ROTATION_Y = Math.PI;

export default function HeroModel() {
  const { scene } = useGLTF(MODEL_PATH);
  const group = useRef<THREE.Group>(null);

  const model = useMemo(() => scene.clone(true), [scene]);

  const fit = useMemo(() => {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);
    const scale = size.y > 0 ? HERO_HEIGHT / size.y : 1;
    return {
      scale,
      position: [-center.x * scale, -bounds.min.y * scale, -center.z * scale] as [number, number, number],
    };
  }, [model]);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;

    model.rotation.y = THREE.MathUtils.damp(model.rotation.y, Math.sin(t * 0.2) * 0.025, 2, delta);

    // Finale: hero is turned sideways toward the bat signal.
    // Set directly (no damping) because the screen is white when this flips.
    if (group.current) {
      group.current.rotation.y = roofProgress.current > 0.0005 ? HERO_END_YAW : HERO_ROTATION_Y;
    }
  });

  return (
    <group ref={group} position={[0, 0.62, -3.3]} rotation={[0, HERO_ROTATION_Y, 0]}>
      <primitive object={model} position={fit.position} scale={fit.scale} />
    </group>
  );
}

useGLTF.preload(MODEL_PATH);