import { Suspense } from "react";
import MapApp from "@/components/MapApp";

export default function Home() {
  return (
    <Suspense>
      <MapApp />
    </Suspense>
  );
}
