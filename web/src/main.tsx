import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false},mutations:{retry:false}}});
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><a className="skip-link" href="#main-content">Přeskočit na obsah</a><App/></BrowserRouter></QueryClientProvider></React.StrictMode>);
