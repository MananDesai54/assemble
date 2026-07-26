import { app, useApp, emit, type SettingsTab } from '../store';
import { setTheme, setMode, wipeEverything, startEngine, syncCamera } from '../controller';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { DeviceSelect } from '../components/DeviceSelect';
import { ActionPicker } from '../components/ActionPicker';
import { IntegrationsCatalog } from '../components/IntegrationsCatalog';
import { ModelSelectors } from '../components/ModelSelectors';
import { VoicePicker } from '../components/VoicePicker';
import { SetupRows, InstallButton } from '../components/SetupRows';

function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line py-2.5 last:border-b-0">
      <label className="text-[13.5px] text-ink">{label}</label>
      {hint && <span className="text-[12.5px] text-dim">{hint}</span>}
      {children}
    </div>
  );
}

function GeneralTab() {
  useApp();
  return (
    <>
      <Row label="Theme">
        <Select value={app.config.theme || 'system'} onValueChange={setTheme}>
          <SelectTrigger className="max-w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Follow system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Microphone"><DeviceSelect /></Row>
      <Row label="Sensitivity" hint="left = softer taps register">
        <Slider
          min={3} max={15} step={0.5}
          defaultValue={[app.config.sensitivity]}
          onValueCommit={async ([v]) => {
            app.config.sensitivity = v;
            await window.assemble.setConfig({ sensitivity: v });
            await startEngine();
          }}
        />
      </Row>
      <Row label="Onboarding" hint="Walk the setup wizard again — nothing is deleted; every step re-checks what's installed and connected.">
        <Button variant="secondary" className="self-start" onClick={() => { app.setupReturn = false; app.setupStep = 0; emit(); setMode('setup'); }}>
          Revisit onboarding
        </Button>
      </Row>
      <div className="mt-3.5 flex flex-col gap-1.5 border-t border-danger pt-4">
        <label className="text-[13.5px] text-ink">Start over</label>
        <span className="text-[12.5px] text-dim">
          Wipes everything: calibration, actions, integration tokens, captured messages, call recordings, Talk chats, Claude Code session history. Back to the intro screen.
        </span>
        <Button variant="danger" className="self-start" onClick={() => void wipeEverything()}>Wipe everything…</Button>
      </div>
    </>
  );
}

function GesturesTab() {
  useApp();
  const extras = app.config.extras;
  const saveExtras = (patch: Partial<typeof extras>) => {
    Object.assign(app.config.extras, patch);
    void window.assemble.setConfig({ extras: { ...app.config.extras } });
    emit();
  };
  return (
    <>
      <Row label="Whistle">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-dim">
          <Switch checked={extras.whistleVolume} onCheckedChange={v => saveExtras({ whistleVolume: v })} />
          <span>Whistle slides system volume — pitch up = louder</span>
        </label>
      </Row>
      <Row label="Blow at the mic">
        <ActionPicker current={extras.blow.action} onChange={action => saveExtras({ blow: { action } })} />
      </Row>
      <Row label="Camera">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-dim">
          <Switch
            checked={extras.camera.enabled}
            onCheckedChange={v => { saveExtras({ camera: { ...extras.camera, enabled: v } }); void syncCamera(); }}
          />
          <span>Hand waves via camera — processed locally, nothing recorded</span>
        </label>
      </Row>
      {extras.camera.enabled && (
        <>
          <Row label="Wave on the left">
            <ActionPicker current={extras.camera.left.action} onChange={action => saveExtras({ camera: { ...extras.camera, left: { action } } })} />
          </Row>
          <Row label="Wave on the right">
            <ActionPicker current={extras.camera.right.action} onChange={action => saveExtras({ camera: { ...extras.camera, right: { action } } })} />
          </Row>
        </>
      )}
      <p className="pt-2.5 text-[12.5px] text-dim">
        Corner knock patterns are edited on the Desk page.
        Voice hotkey: press and release <b>Cmd+Shift</b> alone, anywhere (needs Input Monitoring permission; Ctrl+Shift+Space works as fallback).
      </p>
    </>
  );
}

export function SettingsPage() {
  useApp();
  return (
    <>
      <div><h2 className="text-2xl font-bold tracking-tight">Settings</h2></div>
      <Tabs value={app.settingsTab} onValueChange={v => { app.settingsTab = v as SettingsTab; emit(); }}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="gestures">Gestures</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="ai">Local AI</TabsTrigger>
        </TabsList>
        <div className="glass mt-4 rounded-2xl border border-line p-4">
          <TabsContent value="general"><GeneralTab /></TabsContent>
          <TabsContent value="gestures"><GesturesTab /></TabsContent>
          <TabsContent value="integrations">
            <p className="pb-2.5 text-[12.5px] text-dim">Connected services show up in the sidebar. Tokens live only in the local database.</p>
            <IntegrationsCatalog />
          </TabsContent>
          <TabsContent value="ai">
            <div className="flex flex-col gap-3.5">
              <p className="text-[12.5px] text-dim">
                All local — llama.cpp + whisper.cpp. Nothing leaves this Mac. Changing a model may need a new download
                (run "Install everything" after switching); the brain restarts automatically if it's running.
              </p>
              <ModelSelectors />
              <VoicePicker />
              <SetupRows />
              <InstallButton />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
