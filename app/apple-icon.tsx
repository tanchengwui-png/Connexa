import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at top left, rgba(34,197,94,0.22), transparent 28%), linear-gradient(135deg, #0b1728 0%, #10233d 58%, #14345c 100%)"
        }}
      >
        <div
          style={{
            width: 118,
            height: 118,
            borderRadius: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, rgba(37,99,235,0.96) 0%, rgba(6,182,212,0.96) 100%)"
          }}
        >
          <div
            style={{
            color: "#f8fbff",
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.08em",
              marginLeft: "-4px"
            }}
          >
            C
          </div>
        </div>
      </div>
    ),
    size
  );
}
