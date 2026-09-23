import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Users as UsersIcon } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { UserDto } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/state/auth";

export default function Users() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: UserDto[] }>("/api/v1/users") });

  const create = useMutation({
    mutationFn: (vars: { email: string; password: string; name: string; role: string }) => api.post("/api/v1/users", vars),
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const disable = useMutation({
    mutationFn: (id: number) => api.del(`/api/v1/users/${id}`),
    onSuccess: () => {
      toast("User disabled");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (users.isLoading) return <Loading rows={3} />;
  const list = users.data?.users ?? [];

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Users" subtitle="Operator and client accounts. New users inherit the role you assign; disabled users lose their tokens immediately." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Users" value={list.length} sub="registered" />
        <StatTile label="Operators" value={list.filter((u) => u.role === "operator" || u.role === "admin").length} sub="console access" tone="signal" />
        <StatTile label="Clients" value={list.filter((u) => u.role === "client").length} sub="consumer app" />
        <StatTile label="Active" value={list.filter((u) => !u.disabled).length} sub="not disabled" tone="good" />
      </div>

      <Panel title="Create user">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              email: String(fd.get("email") ?? ""),
              password: String(fd.get("password") ?? ""),
              name: String(fd.get("name") ?? ""),
              role: String(fd.get("role") ?? "client"),
            });
            e.currentTarget.reset();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" name="email" type="email" required className="w-52" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-name">Name</Label>
            <Input id="u-name" name="name" className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-pass">Password</Label>
            <Input id="u-pass" name="password" type="password" required minLength={4} className="w-36" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-role">Role</Label>
            <select id="u-role" name="role" className="h-9 rounded-lg border border-border bg-card px-2.5 text-[13px]">
              <option value="client">client</option>
              <option value="operator">operator</option>
            </select>
          </div>
          <Button type="submit" className="gap-2" disabled={create.isPending}>
            <UserPlus className="h-4 w-4" /> Create
          </Button>
        </form>
      </Panel>

      <Panel>
        <div className="space-y-1.5">
          {list.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-[13px]">
              <UsersIcon className={`h-4 w-4 ${u.disabled ? "text-muted-foreground/40" : "text-primary"}`} />
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-[11px] text-muted-foreground">{u.email}</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{u.role}</span>
              {u.disabled ? <span className="text-[11px] text-rose-400">disabled</span> : <span className="text-[11px] text-emerald-400">active</span>}
              <span className="ml-auto text-[11px] text-muted-foreground">{u.created_ms ? fmtDateTime(u.created_ms) : ""}</span>
              {u.id !== user?.id && !u.disabled && (
                <Button size="sm" variant="ghost" onClick={() => disable.mutate(u.id)}>
                  disable
                </Button>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
