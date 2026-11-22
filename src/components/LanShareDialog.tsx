import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, QrCode, Smartphone, Wifi, WifiOff } from "lucide-react";
import {
  getLanServerInfo,
  isTauriRuntime,
  LanServerInfo,
  startLanServer,
  stopLanServer,
} from "../lib/storage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface LanShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customDataDir?: string;
}

export const LanShareDialog: React.FC<LanShareDialogProps> = ({
  open,
  onOpenChange,
  customDataDir,
}) => {
  const inTauri = isTauriRuntime();
  const [info, setInfo] = useState<LanServerInfo | null>(null);
  const [browserUrl, setBrowserUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeUrl = inTauri ? info?.url ?? "" : browserUrl;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (inTauri) {
      getLanServerInfo()
        .then(async (res) => {
          if (res && !res.running) {
            // Auto-start LAN server when user opens QR share dialog
            setLoading(true);
            try {
              const started = await startLanServer(18420, customDataDir);
              setInfo(started);
            } catch (err) {
              setInfo(res);
              setError(err instanceof Error ? err.message : "启动局域网服务失败");
            } finally {
              setLoading(false);
            }
          } else {
            setInfo(res);
          }
        })
        .catch(() => {});
    } else if (typeof window !== "undefined") {
      setBrowserUrl(window.location.origin);
    }
  }, [open, inTauri, customDataDir]);

  useEffect(() => {
    if (!activeUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(activeUrl, {
      width: 220,
      margin: 2,
      color: {
        dark: "#18181b",
        light: "#ffffff",
      },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [activeUrl]);

  const handleToggleServer = async () => {
    if (!inTauri) return;
    setLoading(true);
    setError(null);
    try {
      if (info?.running) {
        const stopped = await stopLanServer();
        setInfo(stopped);
      } else {
        const started = await startLanServer(18420, customDataDir);
        setInfo(started);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!activeUrl) return;
    await navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            局域网访问与手机扫码
          </DialogTitle>
          <DialogDescription>
            手机与电脑连接同一 Wi-Fi，扫码即可在手机浏览器打开并实时同步数据
          </DialogDescription>
        </DialogHeader>

        <Separator className="my-3" />

        <div className="space-y-4">
          {inTauri && (
            <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                {info?.running ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="font-medium text-foreground">
                  {info?.running ? "局域网服务运行中" : "局域网服务已停止"}
                </span>
              </div>
              <Button
                type="button"
                variant={info?.running ? "secondary" : "default"}
                size="sm"
                disabled={loading}
                onClick={handleToggleServer}
              >
                {info?.running ? "停止" : "启动"}
              </Button>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/12 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* QR Code Box */}
          <div className="flex flex-col items-center justify-center rounded-2xl bg-background p-5">
            {qrDataUrl && (!inTauri || info?.running) ? (
              <div className="rounded-xl bg-white p-2.5 shadow-card-rest">
                <img
                  src={qrDataUrl}
                  alt="ShibaPlan LAN QR Code"
                  className="h-44 w-44"
                />
              </div>
            ) : (
              <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-xl bg-muted/50 text-xs text-muted-foreground">
                <QrCode className="h-8 w-8 opacity-40" />
                <span>{inTauri ? "点击上方启动服务" : "请输入局域网地址"}</span>
              </div>
            )}

            <div className="mt-3 flex w-full items-center gap-1.5">
              <Input
                type="text"
                value={activeUrl}
                readOnly={inTauri}
                onChange={(e) => setBrowserUrl(e.target.value)}
                placeholder="http://192.168.x.x:1420"
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={handleCopy}
                disabled={!activeUrl}
                title="复制链接"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {!inTauri && activeUrl.includes("localhost") && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                提示：当前为浏览器预览模式，手机扫码请将 localhost 改为电脑的局域网 IP（或在桌面端打开自动识别）
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
