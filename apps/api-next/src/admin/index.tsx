import { createRoot } from "react-dom/client";
import Main from "./components/main";

export default function Admin() {
    return <div>
        <header className="flex items-center justify-between p-4">
            <h1 className="text-2xl font-bold">Admin Page</h1>
        </header>
        <Main />
    </div>;
}


const root = createRoot(document.getElementById('root')!);
root.render(<Admin />);
