import { COLORS } from "@bench/ui";

/** A ring on the ground where the car went out, shown during an incident replay. */
export function IncidentRing({ x, y }: { x: number; y: number }) {
  return (
    <mesh position={[x, 0.06, -y]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
      <ringGeometry args={[3.2, 4, 48]} />
      <meshBasicMaterial color={COLORS["status-dnf"]} transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}
