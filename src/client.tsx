import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:boolean}> {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  render(){return this.state.error?<main className="fatal"><h1>页面暂时没有打开</h1><p>记录仍然保存在原处，请重新加载。</p><button onClick={()=>location.reload()}>重新加载</button></main>:this.props.children;}
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);
