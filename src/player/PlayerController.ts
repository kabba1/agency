import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { VoxelWorld } from "../world/VoxelWorld";

type InputState = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
  sprint: boolean;
};

const PLAYER_HEIGHT = 1.78;
const PLAYER_RADIUS = 0.32;
const GRAVITY = 23;
const WALK_SPEED = 7.2;
const SPRINT_SPEED = 10.2;
const FLY_SPEED = 12;
const JUMP_SPEED = 8.2;
const AIR_CONTROL = 0.58;

export class PlayerController {
  readonly controls: PointerLockControls;
  private readonly input: InputState = { forward: false, backward: false, left: false, right: false, jump: false, down: false, sprint: false };
  private velocity = new THREE.Vector3();
  private grounded = false;
  private flyMode = false;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private world: VoxelWorld,
    onPointerLockChange: (locked: boolean) => void
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    this.controls.addEventListener("lock", () => onPointerLockChange(true));
    this.controls.addEventListener("unlock", () => onPointerLockChange(false));
    this.resetToSpawn(world);
    this.bindInput();
  }

  setWorld(world: VoxelWorld) {
    this.world = world;
    this.resetToSpawn(world);
  }

  lock() {
    this.controls.lock();
  }

  setFlyMode(enabled: boolean) {
    this.flyMode = enabled;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
  }

  toggleFlyMode() {
    this.setFlyMode(!this.flyMode);
    return this.flyMode;
  }

  isFlyMode() {
    return this.flyMode;
  }

  setLookSensitivity(value: number) {
    this.controls.pointerSpeed = Math.max(0.35, Math.min(2, value));
    return this.controls.pointerSpeed;
  }

  update(dt: number) {
    const camera = this.controls.object;
    this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.forward.y = 0;
    this.forward.normalize();

    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.right.y = 0;
    this.right.normalize();

    const desired = new THREE.Vector3();
    if (this.input.forward) desired.add(this.forward);
    if (this.input.backward) desired.sub(this.forward);
    if (this.input.right) desired.add(this.right);
    if (this.input.left) desired.sub(this.right);
    const walkSpeed = this.input.sprint ? SPRINT_SPEED : WALK_SPEED;
    if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(this.grounded ? walkSpeed : walkSpeed * AIR_CONTROL);

    if (this.flyMode) {
      if (this.input.jump) desired.y += 1;
      if (this.input.down) desired.y -= 1;
      if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(this.input.sprint ? FLY_SPEED * 1.6 : FLY_SPEED);
      camera.position.addScaledVector(desired, dt);
      return;
    }

    this.velocity.x = desired.x;
    this.velocity.z = desired.z;

    if (this.input.jump && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    this.velocity.y -= GRAVITY * dt;
    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("z", this.velocity.z * dt);
    this.moveAxis("y", this.velocity.y * dt);
    this.snapToGround();

    if (camera.position.y < -10) this.resetToSpawn(this.world);
  }

  private resetToSpawn(world: VoxelWorld) {
    this.controls.object.position.set(world.spawn.x + 0.5, world.spawn.y + PLAYER_HEIGHT, world.spawn.z + 0.5);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
  }

  private moveAxis(axis: "x" | "y" | "z", amount: number) {
    if (amount === 0) return;

    const position = this.controls.object.position;
    position[axis] += amount;
    if (this.collides(position)) {
      position[axis] -= amount;
      if (axis === "y") {
        if (amount < 0) this.grounded = true;
        this.velocity.y = 0;
      }
    } else if (axis === "y" && amount < 0) {
      this.grounded = false;
    }
  }

  private snapToGround() {
    if (this.velocity.y > 0 || this.grounded) return;
    const position = this.controls.object.position;
    position.y -= 0.08;
    if (this.collides(position)) {
      position.y += 0.08;
      this.grounded = true;
      this.velocity.y = 0;
    } else {
      position.y += 0.08;
    }
  }

  private collides(eyePosition: THREE.Vector3) {
    const minX = eyePosition.x - PLAYER_RADIUS;
    const maxX = eyePosition.x + PLAYER_RADIUS;
    const minY = eyePosition.y - PLAYER_HEIGHT;
    const maxY = eyePosition.y - 0.08;
    const minZ = eyePosition.z - PLAYER_RADIUS;
    const maxZ = eyePosition.z + PLAYER_RADIUS;

    for (let x = Math.floor(minX); x <= Math.floor(maxX); x += 1) {
      for (let y = Math.floor(minY); y <= Math.floor(maxY); y += 1) {
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z += 1) {
          for (const box of this.world.getCollisionBoxesAt(x, y, z)) {
            if (
              minX < x + box.maxX &&
              maxX > x + box.minX &&
              minY < y + box.maxY &&
              maxY > y + box.minY &&
              minZ < z + box.maxZ &&
              maxZ > z + box.minZ
            ) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  private bindInput() {
    window.addEventListener("keydown", (event) => this.setKey(event.code, true));
    window.addEventListener("keyup", (event) => this.setKey(event.code, false));
  }

  private setKey(code: string, value: boolean) {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        this.input.forward = value;
        break;
      case "KeyS":
      case "ArrowDown":
        this.input.backward = value;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.input.left = value;
        break;
      case "KeyD":
      case "ArrowRight":
        this.input.right = value;
        break;
      case "Space":
        this.input.jump = value;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.input.down = value;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.input.sprint = value;
        break;
    }
  }
}
