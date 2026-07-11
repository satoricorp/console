import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = {
  width: 32,
  height: 32,
};

export const contentType = "image/png";

const xer0 = await readFile(
  join(process.cwd(), "src/fonts/Xer0-Regular.otf"),
);

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "Xer0",
          fontSize: 24,
          lineHeight: 1,
        }}
      >
        X
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Xer0",
          data: xer0,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );
}
