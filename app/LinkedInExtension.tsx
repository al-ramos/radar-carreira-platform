"use client";

import CollectorExtension from "./CollectorExtension";

type LinkedInExtensionProps = { close: () => void; openImport: () => void };

export default function LinkedInExtension({ close, openImport }: LinkedInExtensionProps) {
  return (
    <CollectorExtension
      sourceId="linkedin-extension"
      sourceLabel="Extensão LinkedIn"
      close={close}
      openImport={openImport}
      importLabel="Importar arquivo do LinkedIn (JSON ou CSV)"
    />
  );
}
