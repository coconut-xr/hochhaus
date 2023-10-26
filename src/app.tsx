import {
  DynamicHandModel,
  ExtendedXRPlane,
  HandBoneGroup,
  ImmersiveSessionOrigin,
  SpaceGroup,
  TrackedPlane,
  TrackedPlaneGeometry,
  VisibilityFocusStateGuard,
  XR,
  measureXRPlane,
  useEnterXR,
  useHandPoses,
  useInputSources,
  useTrackedObjectPlanes,
} from "@coconut-xr/natuerlich/react";
import { ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  AlwaysStencilFunc,
  BackSide,
  Box3,
  BoxGeometry,
  CanvasTexture,
  EqualStencilFunc,
  FrontSide,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ReplaceStencilOp,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three";
import { getInputSourceId, getPlaneId } from "@coconut-xr/natuerlich";
import { clamp } from "three/src/math/MathUtils.js";
import {
  XCurvedPointer,
  XSphereCollider,
} from "@coconut-xr/xinteraction/react";
import { Sphere } from "@react-three/drei";

const options: XRSessionInit = {
  requiredFeatures: ["local-floor", "plane-detection", "hand-tracking"],
};

const levelPositions = [2, 5, 8];

let targetFloor = 0;
let currentFloorPosition = levelPositions[targetFloor];

export default function App() {
  const enterVR = useEnterXR("immersive-ar", options);
  useEffect(() => {
    const element = document.getElementById("enter-vr");
    if (element == null) {
      return;
    }
    element.style.display = "block";
    element.addEventListener("click", enterVR);
    return () => element.removeEventListener("click", enterVR);
  }, []);
  const inside = useIsInside();
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current == null) {
      return;
    }
    const targetFloorPosition = levelPositions[targetFloor];
    const diff = targetFloorPosition - currentFloorPosition;
    const normalizedDiff = diff === 0 ? 0 : diff / Math.abs(diff);
    const x = Math.abs(diff) < Math.abs(normalizedDiff) ? diff : normalizedDiff;
    currentFloorPosition += x * delta;
    ref.current.position.y = currentFloorPosition;
  });
  return (
    <>
      <XR />
      <ambientLight />
      <directionalLight position={[1, 1, 1]} />
      <ambientLight />
      <ImmersiveSessionOrigin
        ref={ref}
        position-y={levelPositions[0]}
        cameraContent={
          <mesh renderOrder={-1}>
            <sphereGeometry />
            <meshBasicMaterial
              depthWrite={false}
              depthTest={false}
              side={BackSide}
              color="white"
              stencilWrite
              stencilRef={inside ? 1 : 0}
              stencilFunc={EqualStencilFunc}
            />
          </mesh>
        }
      >
        <DrawHands />
        <group visible={inside}>
          <Openings inside={inside} />
        </group>
        <Suspense>
          <Elevators inside={inside} />
        </Suspense>
      </ImmersiveSessionOrigin>
      {levelPositions.map((position, index) => (
        <group key={index} position-y={position}>
          <InsideWalls floor={index} inside={inside} key={index} />
        </group>
      ))}
      <group visible={!inside}>
        {levelPositions.map((position, index) => (
          <group key={index} position-y={position}>
            <Openings inside={inside} />
          </group>
        ))}
      </group>
      <Suspense>
        <City stencilRef={inside ? 1 : 0} />
      </Suspense>
      <Suspense>
        <OutsideWalls inside={inside} />
      </Suspense>
    </>
  );
}

function InsideWalls({ inside, floor }: { floor: number; inside: boolean }) {
  const ref = useRef<Group>(null);
  const planes = useTrackedObjectPlanes("wall");
  useFrame(() => {
    if (ref.current == null) {
      return;
    }
    ref.current.visible = targetFloor === floor;
  });
  return (
    <group ref={ref}>
      {planes?.map((plane) => (
        <InsideWall inside={inside} key={getPlaneId(plane)} plane={plane} />
      ))}
    </group>
  );
}

const canvasSize = 2048;

function InsideWall({ plane, inside }: { inside: boolean; plane: XRPlane }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | undefined>(
    undefined
  );
  const context = useMemo(() => canvas?.getContext("2d"), [canvas]);
  const texture = useMemo(
    () => (canvas == null ? undefined : new CanvasTexture(canvas)),
    [canvas]
  );
  const lastPositionMap = useMemo(() => new Map<number, Vector2>(), []);
  return (
    <group
      visible={texture != null}
      onPointerMove={useCallback(
        (e: ThreeEvent<PointerEvent>) => {
          if (e.pointerId === 55 || e.pointerId === 56) {
            return;
          }
          if (canvas == null) {
            setCanvas((existingElement) => {
              if (existingElement != null) {
                return;
              }
              const element = document.createElement("canvas");
              element.width = canvasSize;
              element.height = canvasSize;
              return element;
            });
            return;
          }
          if (context == null || texture == null) {
            return;
          }
          const point = new Vector2(
            Math.floor(e.uv!.x * canvasSize),
            canvasSize - Math.floor(e.uv!.y * canvasSize)
          );
          if (e.pointerId < 0) {
            //eraser
            context.beginPath();
            context.globalCompositeOperation = "destination-out";
            context.moveTo(point.x, point.y);
            context.arc(point.x, point.y, 25, 0, 2 * Math.PI);
            context.fill();
            texture.needsUpdate = true;
            return;
          }
          context.beginPath();
          const lastPoint = lastPositionMap.get(e.pointerId) ?? point;
          lastPositionMap.set(e.pointerId, point);
          context.globalCompositeOperation = "source-over";
          context.lineWidth = 4;
          context.moveTo(lastPoint.x, lastPoint.y);
          context.lineTo(point.x, point.y);
          context.stroke();
          texture.needsUpdate = true;
        },
        [context]
      )}
      onPointerLeave={useCallback(
        (e: ThreeEvent<PointerEvent>) => lastPositionMap.delete(e.pointerId),
        []
      )}
    >
      <TrackedPlane plane={plane}>
        <meshBasicMaterial
          side={FrontSide}
          stencilWrite
          stencilRef={0}
          stencilFunc={inside ? EqualStencilFunc : NotEqualStencilFunc}
          map={texture}
          transparent
        />
      </TrackedPlane>
    </group>
  );
}

const positionHelper = new Vector3();
const cameraPosition = new Vector3();

function useIsInside(): boolean {
  const [inside, setInside] = useState(true);
  const walls = useTrackedObjectPlanes("wall");
  const wallInfos = useMemo(
    () =>
      walls?.map((wall) => ({
        invertedMatrix:
          wall.initialPose != null
            ? new Matrix4()
                .fromArray(wall.initialPose.transform.matrix)
                .invert()
            : new Matrix4(),
        box: measureXRPlane(wall, new Box3()),
      })),
    [walls]
  );
  useFrame((state) => {
    if (wallInfos == null) {
      return;
    }
    state.camera.getWorldPosition(cameraPosition);
    let nearestDistance: number = Infinity;
    let nearestY: number | undefined;
    for (const { box, invertedMatrix } of wallInfos) {
      //transform to local
      positionHelper.copy(cameraPosition).applyMatrix4(invertedMatrix);
      const distance = box.distanceToPoint(positionHelper);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestY = positionHelper.y;
      }
    }
    setInside(nearestY == null || nearestY < 0);
  });
  return inside;
}

function isDoor(plane: XRPlane & { semanticLabel?: string }): boolean {
  return plane.semanticLabel === "door";
}

function Openings({ inside }: { inside: boolean }) {
  const planes = [
    ...(useTrackedObjectPlanes("window") ?? []),
    ...(useTrackedObjectPlanes("door") ?? []),
  ];
  return (
    <>
      {planes.map((plane) => (
        <SpaceGroup
          key={getPlaneId(plane)}
          space={plane.planeSpace}
          initialPose={plane.initialPose}
        >
          <Frame offset={inside ? 0.075 : -0.075} depth={0.15} plane={plane}>
            {isDoor(plane) && (
              <Suspense>
                <Door />
              </Suspense>
            )}
          </Frame>
          <mesh renderOrder={-3} position-y={inside ? 0.15 : -0.15}>
            <TrackedPlaneGeometry plane={plane} />
            <meshBasicMaterial
              stencilWrite
              depthWrite={false}
              depthTest={false}
              colorWrite={false}
              side={inside ? FrontSide : BackSide}
              stencilRef={1}
              stencilZPass={ReplaceStencilOp}
            />
          </mesh>
          <mesh renderOrder={-3} position-y={inside ? -0.01 : 0.01}>
            <TrackedPlaneGeometry plane={plane} />
            <meshBasicMaterial
              stencilWrite
              depthWrite={false}
              depthTest={false}
              colorWrite={false}
              side={inside ? FrontSide : BackSide}
              stencilRef={1}
              stencilZPass={ReplaceStencilOp}
            />
          </mesh>
        </SpaceGroup>
      ))}
    </>
  );
}

function DrawHands() {
  const inputSources = useInputSources();
  return (
    <VisibilityFocusStateGuard>
      {inputSources.map((inputSource) =>
        inputSource.hand == null ? undefined : (
          <DrawHand
            key={getInputSourceId(inputSource)}
            hand={inputSource.hand}
            inputSource={inputSource}
          />
        )
      )}
    </VisibilityFocusStateGuard>
  );
}

const shortLine = [new Vector3(0, 0, 0.03), new Vector3(0, 0, -0.025)];
const longLine = [new Vector3(0, 0, 0.06), new Vector3(0, 0, -0.06)];
//const geometry = new BufferGeometry().setFromPoints(longLine);

function DrawHand({
  inputSource,
  hand,
}: {
  inputSource: XRInputSource;
  hand: XRHand;
}) {
  const [rubber, setRubber] = useState(false);
  useHandPoses(
    hand,
    inputSource.handedness,
    useCallback((pose: string) => setRubber(pose === "fist"), []),
    {
      fist: "fist.handpose",
      point: "point.handpose",
    }
  );
  return (
    <Suspense>
      <DynamicHandModel hand={hand} handedness={inputSource.handedness}>
        <HandBoneGroup joint="index-finger-tip">
          {!rubber && (
            <XCurvedPointer
              id={getInputSourceId(inputSource)}
              points={shortLine}
            />
          )}
          <XSphereCollider
            radius={0.1}
            distanceElement={{ id: 0, downRadius: 0.03 }}
            id={inputSource.handedness === "left" ? 55 : 56}
          />
        </HandBoneGroup>
        <HandBoneGroup joint="wrist">
          {rubber && (
            <group
              rotation-y={
                inputSource.handedness === "left" ? Math.PI / 2 : -Math.PI / 2
              }
              position-z={-0.07}
              position-y={-0.03}
            >
              <XCurvedPointer
                id={-getInputSourceId(inputSource)}
                points={longLine}
              />
            </group>
          )}
        </HandBoneGroup>
      </DynamicHandModel>
    </Suspense>
  );
}

function OutsideWalls({ inside }: { inside: boolean }) {
  const planes = useTrackedObjectPlanes("wall");
  const texture: Texture = useLoader(TextureLoader, "/hochhaus/texture.jpg");
  texture.repeat.y = 20;
  texture.repeat.x = 5;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return (
    <>
      <group visible={!inside}>
        {planes?.map((plane) => (
          <SpaceGroup
            key={getPlaneId(plane)}
            space={plane.planeSpace}
            initialPose={plane.initialPose}
          >
            <mesh scale-z={10}>
              <TrackedPlaneGeometry plane={plane} />
              <meshBasicMaterial
                stencilWrite
                stencilRef={0}
                stencilFunc={EqualStencilFunc}
                map={texture}
                side={BackSide}
              />
            </mesh>
          </SpaceGroup>
        ))}
      </group>
    </>
  );
}

const geometry1 = new PlaneGeometry(1, 1);
geometry1.rotateY(Math.PI);
geometry1.translate(0.5, 0, 0);

const geometry2 = new PlaneGeometry(1, 1);
geometry2.rotateY((1 * Math.PI) / 2);
geometry2.translate(1, 0, 0.5);

const geometry3 = new PlaneGeometry(1, 1);
geometry3.translate(0.5, 0, 1);

const geometry4 = new PlaneGeometry(1, 1);
geometry4.rotateY((3 * Math.PI) / 2);
geometry4.translate(0, 0, 0.5);

const geometry = mergeGeometries([geometry1, geometry2, geometry3, geometry4]);

function Elevators({ inside }: { inside: boolean }) {
  const texture: Texture = useLoader(TextureLoader, "/hochhaus/elevator.png");
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const maxAnisotropy = useThree(({ gl }) =>
    gl.capabilities.getMaxAnisotropy()
  );
  texture.anisotropy = maxAnisotropy;
  texture.repeat.set(3, 20);
  const planes = useTrackedObjectPlanes("door");
  return (
    <>
      {planes?.map((plane) => (
        <Elevator
          key={getPlaneId(plane)}
          texture={texture}
          inside={inside}
          plane={plane}
        />
      ))}
    </>
  );
}

const geometry5 = new PlaneGeometry(1, 1);
geometry5.rotateX(-Math.PI / 2);
geometry5.translate(0.5, 0.5, 0.5);

const elevatorGeometry = mergeGeometries([
  geometry1,
  geometry2,
  geometry3,
  geometry4,
  geometry5,
]);
elevatorGeometry.translate(-0.5, 0.5, 0);
elevatorGeometry.scale(1.5, 1.5, 2.5);

const buttonGeometry = new BoxGeometry();

function Elevator({
  plane,
  inside,
  texture,
}: {
  inside: boolean;
  plane: ExtendedXRPlane;
  texture: Texture;
}) {
  const { position, rotation } = useMemo(() => {
    const transform = plane.initialPose?.transform;
    const {
      x: ox,
      y: oy,
      z: oz,
      w: ow,
    } = transform?.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
    const { x, y, z } = transform?.position ?? { x: 0, y: 0, z: 0 };
    const box = measureXRPlane(plane, new Box3());
    return {
      position: new Vector3(x, y + box.min.z, z),
      rotation: new Quaternion(ox, oy, oz, ow),
    };
  }, [plane]);

  return (
    <mesh position={position} quaternion={rotation} geometry={elevatorGeometry}>
      <meshPhongMaterial
        stencilWrite
        transparent
        stencilFunc={EqualStencilFunc}
        stencilRef={inside ? 1 : 0}
        side={BackSide}
        map={texture}
      />
      {levelPositions.map((_, i) => (
        <ElevatorButton key={i} inside={inside} index={i} />
      ))}
    </mesh>
  );
}

function ElevatorButton({ index, inside }: { inside: boolean; index: number }) {
  const ref = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    if (ref.current == null) {
      return;
    }
    const isPressed = targetFloor === index;
    ref.current.color.set(isPressed ? "green" : "gray");
  });
  return (
    <mesh
      position={[0, 1.5, 1.5 + index * 0.1]}
      scale={0.05}
      geometry={buttonGeometry}
      onPointerDown={(e) => {
        if (e.pointerId != 55 && e.pointerId != 56) {
          return;
        }
        targetFloor = index;
      }}
    >
      <meshBasicMaterial
        ref={ref}
        stencilWrite
        transparent
        stencilFunc={EqualStencilFunc}
        stencilRef={inside ? 1 : 0}
      />
    </mesh>
  );
}

function Frame({
  plane,
  depth,
  offset,
  children,
}: {
  offset: number;
  depth: number;
  plane: XRPlane;
  children?: ReactNode;
}) {
  const box = useMemo(() => measureXRPlane(plane, new Box3()), [plane]);
  return (
    <group
      position={[box.min.x, offset, box.min.z]}
      scale={[box.max.x - box.min.x, depth, box.max.z - box.min.z]}
    >
      {children}
      <mesh geometry={geometry}>
        <meshPhongMaterial color="gray" side={BackSide} />
      </mesh>
      <mesh renderOrder={-2} geometry={geometry}>
        <meshBasicMaterial
          stencilWrite
          stencilZPass={ReplaceStencilOp}
          stencilRef={0}
          colorWrite={false}
          side={FrontSide}
        />
      </mesh>
    </group>
  );
}

const leftBoxGeometry = new BoxGeometry(1, 1, 1);
const rightBoxGeometry = new BoxGeometry(1, 1, 1);
const uvAttribute = rightBoxGeometry.attributes.uv;

for (let i = 0; i < uvAttribute.count; i++) {
  const u = uvAttribute.getX(i);
  const v = uvAttribute.getY(i);
  uvAttribute.setXY(i, 1.0 - u, v);
}

const vec1Helper = new Vector3();
const vec2Helper = new Vector3();

function Door() {
  const texture: Texture = useLoader(TextureLoader, "/hochhaus/door.jpg");
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.y = 4;
  const leftRef = useRef<Mesh>(null);
  const rightRef = useRef<Mesh>(null);
  let openRef = useRef(0);
  useFrame((state, delta) => {
    if (leftRef.current == null || rightRef.current == null) {
      return;
    }
    state.camera.getWorldPosition(vec1Helper);
    leftRef.current.getWorldPosition(vec2Helper);
    const targetFloorPosition = levelPositions[targetFloor];
    const elevatorMoving =
      Math.abs(targetFloorPosition - currentFloorPosition) > 0.05;
    const shouldBeOpen =
      !elevatorMoving && vec1Helper.distanceTo(vec2Helper) < 1.3;
    openRef.current = clamp(
      openRef.current + (shouldBeOpen ? -1 : 1) * delta,
      0.01,
      0.995
    );
    const open = openRef.current;
    leftRef.current.scale.x = open * 0.5;
    leftRef.current.position.x = open * 0.25 + 0.001;
    rightRef.current.scale.x = open * 0.5;
    rightRef.current.position.x = 1.0 - open * 0.25 - 0.001;
    texture.repeat.x = open;
    texture.offset.x = -open;
  });
  return (
    <>
      <mesh
        ref={rightRef}
        position={[0.25, 0, 0.5]}
        scale={[0.5, 1, 1]}
        geometry={rightBoxGeometry}
      >
        <meshPhongMaterial map={texture} />
      </mesh>
      <mesh
        ref={leftRef}
        position={[0.75, 0, 0.5]}
        scale={[0.5, 1, 1]}
        geometry={leftBoxGeometry}
      >
        <meshPhongMaterial map={texture} />
      </mesh>
    </>
  );
}

function City({ stencilRef }: { stencilRef: number }) {
  const gltf: GLTF = useLoader(GLTFLoader, "city.glb");
  useEffect(
    () =>
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh && object.material instanceof Material) {
          object.material.stencilWrite = true;
          object.material.stencilRef = stencilRef;
          object.material.stencilFunc = EqualStencilFunc;
        }
      }),
    [gltf.scene, stencilRef]
  );
  return <primitive object={gltf.scene} />;
}
