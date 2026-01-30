import { useState, useEffect } from "react";

type User = {
    id: string;
    email: string;
    name: string | null;
    display_name: string | null;
};

type Workspace = {
    id: string;
    name: string;
    slug: string;
};

export default function Main() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [selectedWorkspace, setSelectedWorkspace] = useState("");
    const [seeding, setSeeding] = useState(false);
    const [seedResult, setSeedResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        if (user) fetchWorkspaces();
    }, [user]);

    async function checkAuth() {
        try {
            const res = await fetch("/api/users/me/", { credentials: "include" });
            if (res.ok) {
                const data = await res.json();
                setUser(data);
            }
        } catch {
            // not authenticated
        } finally {
            setLoading(false);
        }
    }

    async function fetchWorkspaces() {
        try {
            const res = await fetch("/api/workspaces/", { credentials: "include" });
            if (res.ok) {
                const data = await res.json();
                setWorkspaces(Array.isArray(data) ? data : data.results || []);
                if (data.length > 0) setSelectedWorkspace(data[0].id);
            }
        } catch {
            // ignore
        }
    }

    async function handleSeed() {
        if (!selectedWorkspace) return;
        setSeeding(true);
        setSeedResult(null);
        try {
            const res = await fetch("/api/instances/seed/", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspace_id: selectedWorkspace }),
            });
            const data = await res.json();
            if (res.ok) {
                setSeedResult({ type: "success", message: data.message || "Workspace seeded successfully" });
            } else {
                setSeedResult({ type: "error", message: data.detail || "Failed to seed workspace" });
            }
        } catch (err: any) {
            setSeedResult({ type: "error", message: err.message || "Network error" });
        } finally {
            setSeeding(false);
        }
    }

    if (loading) {
        return <div style={styles.container}><p style={styles.muted}>Loading...</p></div>;
    }

    if (!user) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <h2 style={styles.cardTitle}>Authentication Required</h2>
                    <p style={styles.muted}>You must be logged in to access admin tools.</p>
                    <p style={{ ...styles.muted, marginTop: 8 }}>
                        Log in at <a href="http://localhost:3000" style={styles.link}>localhost:3000</a> first, then refresh this page.
                    </p>
                </div>
            </div>
        );
    }

    const selectedWs = workspaces.find((w) => w.id === selectedWorkspace);

    return (
        <div style={styles.container}>
            <p style={styles.muted}>Signed in as <strong>{user.email}</strong></p>

            <div style={styles.card}>
                <h2 style={styles.cardTitle}>Seed Workspace</h2>
                <p style={styles.cardDesc}>
                    Populate a workspace with sample projects, states, labels, cycles, modules, issues, views, and pages.
                </p>

                {workspaces.length === 0 ? (
                    <p style={styles.muted}>No workspaces found. Create one first.</p>
                ) : (
                    <>
                        <label style={styles.label}>Workspace</label>
                        <select
                            value={selectedWorkspace}
                            onChange={(e) => {
                                setSelectedWorkspace(e.target.value);
                                setSeedResult(null);
                            }}
                            style={styles.select}
                        >
                            {workspaces.map((ws) => (
                                <option key={ws.id} value={ws.id}>
                                    {ws.name} ({ws.slug})
                                </option>
                            ))}
                        </select>

                        <button
                            onClick={handleSeed}
                            disabled={seeding || !selectedWorkspace}
                            style={{
                                ...styles.button,
                                opacity: seeding ? 0.6 : 1,
                                cursor: seeding ? "not-allowed" : "pointer",
                            }}
                        >
                            {seeding ? "Seeding..." : "Seed Data"}
                        </button>
                    </>
                )}

                {seedResult && (
                    <div
                        style={{
                            ...styles.result,
                            borderColor: seedResult.type === "success" ? "#16a34a" : "#ef4444",
                            color: seedResult.type === "success" ? "#4ade80" : "#f87171",
                        }}
                    >
                        {seedResult.message}
                    </div>
                )}
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        padding: "0 24px 24px",
        maxWidth: 600,
    },
    muted: {
        color: "#a3a3a3",
        fontSize: 14,
        marginBottom: 16,
    },
    link: {
        color: "#60a5fa",
        textDecoration: "underline",
    },
    card: {
        background: "#171717",
        border: "1px solid #262626",
        borderRadius: 8,
        padding: 24,
        marginTop: 16,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: 600,
        marginBottom: 8,
    },
    cardDesc: {
        color: "#a3a3a3",
        fontSize: 14,
        marginBottom: 20,
    },
    label: {
        display: "block",
        fontSize: 13,
        fontWeight: 500,
        color: "#a3a3a3",
        marginBottom: 6,
    },
    select: {
        width: "100%",
        padding: "8px 12px",
        background: "#0a0a0a",
        border: "1px solid #333",
        borderRadius: 6,
        color: "#e5e5e5",
        fontSize: 14,
        marginBottom: 16,
        outline: "none",
    },
    button: {
        padding: "10px 20px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 500,
    },
    result: {
        marginTop: 16,
        padding: "10px 14px",
        border: "1px solid",
        borderRadius: 6,
        fontSize: 14,
    },
};