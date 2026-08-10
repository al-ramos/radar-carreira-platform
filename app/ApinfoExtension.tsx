"use client";

import CollectorExtension from "./CollectorExtension";

type ApinfoExtensionProps = { close: () => void; openImport: () => void };

export default function ApinfoExtension({ close, openImport }: ApinfoExtensionProps) {
  return (
    <CollectorExtension sourceId="apinfo-extension" sourceLabel="Extensão APinfo" close={close} openImport={openImport} />
  );
}
