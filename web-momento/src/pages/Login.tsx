import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "@/state/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("operator@momento.local");
  const [password, setPassword] = useState("momento");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aurora flex min-h-dvh items-center justify-center p-5">
      <div className="animate-in-up w-full max-w-sm rounded-2xl border border-border/80 bg-card/70 p-7 backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 font-data text-sm font-bold text-primary">M</span>
          <div>
            <h1 className="text-[16px] font-semibold">Sign in to Momento</h1>
            <p className="text-[12px] text-muted-foreground">Operator console access</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
          <Button type="submit" className="w-full gap-2" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </Button>
        </form>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            Bootstrapped operator: <span className="font-data text-foreground">operator@momento.local / momento</span> — change it in Master Settings after first sign-in.
          </p>
        </div>
        <p className="mt-4 text-center text-[12px] text-muted-foreground">
          <Link to="/" className="hover:text-foreground">← Back to landing</Link>
        </p>
      </div>
    </div>
  );
}
