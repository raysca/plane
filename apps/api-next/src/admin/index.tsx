import { createRoot } from "react-dom/client";
import Main from "./components/main";

export default function Admin() {
    return <div>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Admin</h1>
        </header>
        <Main />
    </div>;
}


const root = createRoot(document.getElementById('root')!);
root.render(<Admin />);
