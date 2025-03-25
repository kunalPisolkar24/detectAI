"use client";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { FaGoogle, FaGithub } from "react-icons/fa";
import { signIn } from "next-auth/react";
import { Card, CardContent, CardHeader, CardFooter } from "@workspace/ui/components/card";
import { AuthHeader } from "./auth-header";
import { BackButton } from "./back-button";
import { Button } from "@workspace/ui/components/button";
import AuthImg from "@/public/authImage.jpg";
import { Logo } from "@/components/common";

export const CardWrapper = ({ label, title, backButtonHref, backButtonLabel, children }: any) => {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return null;
  }
  const currentTheme = theme === "system" ? resolvedTheme : theme;
  const iconColor = currentTheme === "dark" ? "text-white" : "text-black";
  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block w-3/4 relative text-white">
        <div className="w-full h-[40%] bg-gradient-to-t from-transparent to-black/50 absolute top-0 left-0 z-10" />
        <div className="w-full h-[30%] bg-gradient-to-b from-transparent to-black/50 absolute bottom-0 left-0 z-10" />
        <Image src={AuthImg} alt="Auth image" fill className="w-full h-full object-cover" />
        <div className="absolute top-10 left-10 z-10">
          <Logo />
        </div>
        <div className="absolute bottom-10 left-10 z-10 w-[90%]">
          <blockquote className="space-y-2">
            <p className="text-lg">
              &ldquo;Using Detect AI has drastically improved our ability to identify AI-generated text, saving us time and ensuring the authenticity of our content. It has streamlined our processes, allowing us to focus more on delivering valuable, original material to our audience.&rdquo;
            </p>
            <footer className="text-sm">Bhaskar P.</footer>
          </blockquote>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex justify-center items-center py-10 px-3 md:px-10">
        <Card className="w-full max-w-md shadow-md">
          <CardHeader>
            <AuthHeader label={label} title={title} />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <Button onClick={() => signIn("google", { callbackUrl: '/chat' })} className="w-full py-2 px-4 font-semibold flex items-center justify-center" variant="outline">
                  <FaGoogle className={iconColor} size={20} />
                  Continue with Google
                </Button>
                <Button onClick={() => signIn("github", { callbackUrl: '/chat' })} className="w-full py-2 px-4 font-semibold flex items-center justify-center" variant="outline">
                  <FaGithub className={iconColor} size={20} />
                  Continue with GitHub
                </Button>
              </div>
              <div className="flex items-center my-6">
                <div className="flex-grow border-t border-gray-300"></div>
                <span className="px-4 text-gray-600">or</span>
                <div className="flex-grow border-t border-gray-300"></div>
              </div>
              {children}
            </div>
          </CardContent>
          <CardFooter>
            <BackButton label={backButtonLabel} href={backButtonHref} />
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
