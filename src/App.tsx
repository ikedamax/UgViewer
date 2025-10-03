import UgViewer from "@/components/UgViewer";
import { sampleUg } from "@/lib/sampleUg";

function App() {
  return (
    <div className="min-h-screen bg-neutral-100">
      <UgViewer ug={sampleUg} />
    </div>
  );
}

export default App;
