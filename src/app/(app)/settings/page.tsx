'use client';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { del, errMsg, patch } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { getSocket } from '@/lib/socket';
import { Avatar, Button, Card, Input, Toggle } from '@/components/ui';
import ThemeToggle from '@/components/ThemeToggle';

export default function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user?.displayName ?? '');
  const [avatar, setAvatar] = useState(user?.avatarUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (!user) return null;

  const save = async (body: Record<string, unknown>, okText = 'Saved.') => {
    setSaving(true); setMsg(null);
    try { setUser((await patch<{ user: Me }>('/api/me', body)).user); setMsg({ ok: true, text: okText }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setSaving(false); }
  };
  const deleteAccount = async () => {
    setDelErr(null);
    try { await del('/api/me', { password: pw }); getSocket().disconnect(); setUser(null); router.replace('/'); }
    catch (e) { setDelErr(errMsg(e)); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-5 px-4 pb-12 pt-6 safe-top">
        <h1 className="text-2xl font-extrabold">Profile &amp; privacy</h1>

        <Card>
          <div className="mb-4 flex items-center gap-4"><Avatar name={name || user.displayName} url={avatar || null} size={64} /><div><p className="font-bold">{user.displayName}</p><p className="text-sm text-muted">@{user.username}</p></div></div>
          <div className="space-y-3">
            <Input label="Display name" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
            <Input label="Profile picture link (optional)" value={avatar} placeholder="https://…" onChange={(e) => setAvatar(e.target.value)} />
            <Button loading={saving} onClick={() => save({ displayName: name, avatarUrl: avatar.trim() === '' ? null : avatar.trim() })}>Save profile</Button>
            {msg && <p role="status" className={msg.ok ? 'text-sm text-ok' : 'text-sm text-danger'}>{msg.text}</p>}
          </div>
        </Card>

        <Card>
          <h2 className="font-bold">Privacy</h2>
          <div className="divide-y divide-line">
            <Toggle checked={user.showOnline} onChange={(v) => save({ showOnline: v })} label="Show when I'm online" hint="People who added you can see a green dot." />
            <Toggle checked={user.showLastSeen} onChange={(v) => save({ showLastSeen: v })} label="Show my last seen time" hint="Shown when you're offline." />
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-bold"><ShieldCheck size={18} className="text-brand" /> How your data is protected</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>Passwords are stored only as salted scrypt hashes.</li>
            <li>Connections use HTTPS when the server is deployed with it. This protects data in transit.</li>
            <li>Calls are peer-to-peer WebRTC, which encrypts audio and video between browsers (DTLS-SRTP).</li>
            <li><strong>Text messages are not end-to-end encrypted.</strong> They are stored on the server so history and delivery work. The server operator could read them.</li>
          </ul>
        </Card>

        <Card className="flex items-center justify-between"><div><h2 className="font-bold">Appearance</h2><p className="text-sm text-muted">Switch between light and dark mode.</p></div><ThemeToggle /></Card>

        <Card>
          <Button variant="soft" onClick={logout}><LogOut size={16} /> Log out</Button>
        </Card>

        <Card className="border-danger/40">
          <h2 className="font-bold text-danger">Delete account</h2>
          <p className="mb-3 text-sm text-muted">Permanently deletes your profile, contacts, messages, call history and meetings. This cannot be undone.</p>
          {!confirming ? <Button variant="danger" onClick={() => setConfirming(true)}><Trash2 size={16} /> Delete my account</Button> : (
            <div className="space-y-3">
              <Input label="Enter your password to confirm" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={delErr} />
              <div className="flex gap-2"><Button variant="danger" disabled={!pw} onClick={deleteAccount}>Permanently delete</Button><Button variant="ghost" onClick={() => { setConfirming(false); setPw(''); setDelErr(null); }}>Cancel</Button></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
