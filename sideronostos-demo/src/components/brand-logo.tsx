import Image from "next/image";

import { cn } from "@/lib/utils";

const logoAssets = {
  icon: { src: "/brand/app-logo.png", width: 818, height: 818 },
  coloredIcon: { src: "/brand/app-logo-colored.png", width: 818, height: 818 },
  banner: { src: "/brand/app-logo-banner.png", width: 1254, height: 303 },
} as const;

export function BrandLogo({
  variant = "banner",
  surface = "dark",
  alt = "Agrisata",
  className,
  priority = false,
}: {
  variant?: "icon" | "banner";
  surface?: "dark" | "light";
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const asset = variant === "icon" && surface === "light" ? logoAssets.coloredIcon : logoAssets[variant];

  return (
    <Image
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt={alt}
      priority={priority}
      className={cn("block h-auto max-w-full object-contain", variant === "banner" && surface === "light" && "brightness-0", className)}
    />
  );
}
