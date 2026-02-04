import { BrowserRouter, Routes, Route } from "react-router";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Add routes as they are migrated */}
      </Routes>
    </BrowserRouter>
  );
}

function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Plane (web-next)</h1>
        <p className="mt-2 text-gray-600">Migration in progress...</p>
      </div>
    </div>
  );
}
