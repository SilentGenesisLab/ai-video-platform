"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { accountLinks } from "./account-links";
import {
  ArrowUpRight,
  ArrowDown,
  Clapperboard,
  Check,
  Layers,
  Workflow,
  ShieldCheck,
  History,
  Users,
  Terminal,
  Plus,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="ff-brand">
      <img
        src="/brand/frameflow-mark.png"
        width={38}
        height={38}
        alt=""
        className="ff-brand-image"
      />
      <span>
        frameflow<i>.</i>
      </span>
    </Link>
  );
}
export function ProductScene({ variant = 0 }: { variant?: number }) {
  return (
    <div
      className={"product-scene scene-" + variant}
      role="img"
      aria-label="虚构示例：MORNING 森林绿随行杯的原创概念场景"
    >
      <span className="scene-sun" />
      <span className="scene-orbit" />
      <span className="scene-plinth" />
      <div className="demo-bottle">
        <div className="bottle-cap" />
        <div className="bottle-body">
          <span>
            MORNING
            <br />
            <small>TAKE YOUR TIME</small>
          </span>
        </div>
      </div>
      <span className="scene-leaf leaf-one" />
      <span className="scene-leaf leaf-two" />
      <span className="scene-caption">MORNING / CONCEPT STUDY</span>
    </div>
  );
}
export default function Landing() {
  const [signed, setSigned] = useState(false),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    fetch("/api/v1/auth/me").then((r) => setSigned(r.ok));
  }, []);
  const target = signed ? "/studio/products" : "/register";
  const cta = signed ? "进入工作台" : "开始制作 TVC";
  return (
    <main className="ff-site">
      <header className="ff-nav">
        <Brand />
        <nav aria-label="官网导航" className={menu ? "is-open" : ""}>
          {[
            ["#capabilities", "产品能力"],
            ["#workflow", "制作流程"],
            ["#agents", "Agent 接入"],
            ["#faq", "常见问题"],
          ].map(([url, label]) => (
            <a key={url} href={url} onClick={() => setMenu(false)}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <Link className="login-link" href="/login">
            登录
          </Link>
          <Link className="ff-button small" href={target}>
            {signed ? "进入工作台" : "立即开始"}
            <ArrowUpRight size={15} />
          </Link>
          <button
            className="menu-toggle"
            onClick={() => setMenu(!menu)}
            aria-label={menu ? "关闭导航" : "打开导航"}
            aria-expanded={menu}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <section className="ff-hero">
        <div className="hero-copy">
          <span className="ff-kicker">
            <span />
            TVC CREATIVE PRODUCTION · 广告片制作
          </span>
          <h1>
            从产品需求，
            <br />
            到完整<span>广告片。</span>
          </h1>
          <p>
            把产品需求变成创意，把每一个镜头连成故事。
            <br />
            Brief、策划、分镜、资产与视频，在同一间制作工作室里接力。
          </p>
          <div className="hero-actions">
            <Link className="ff-button" href={target}>
              {cta}
              <ArrowUpRight size={19} />
            </Link>
            <a className="ff-text-link" href="#workflow">
              探索制作流程 <ArrowDown size={16} />
            </a>
          </div>
          <span className="trial-note">
            首次手机注册赠送 20000 积分 · 个人全平台通用
          </span>
          <div className="hero-production-path" aria-label="TVC 制作流程">
            {[
              "需求 Brief",
              "创意策划",
              "工业分镜",
              "视觉资产",
              "视频片段",
              "成片交付",
            ].map((step, i) => (
              <span key={step}>
                <small>0{i + 1}</small>
                {step}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-art">
          <ProductScene />
          <div className="art-label">
            <span>FRAMEFLOW / TVC CONCEPT</span>
            <b>把早晨，握在手里。</b>
            <small>虚构产品 · 原创视觉示例</small>
          </div>
          <span className="hero-format">
            30s <i />
            16:9
          </span>
          <div className="floating-note">
            <span className="agent-avatar">
              <Sparkles size={17} />
            </span>
            <div>
              <b>一个 Brief，一整条制作流程</b>
              <small>人定方向 · Agent 接力</small>
            </div>
            <Check size={17} />
          </div>
          <div className="hero-film-strip" aria-hidden="true">
            <span>01 / MORNING</span>
            <div>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <i key={i} />
              ))}
            </div>
            <span>00:00 / 00:30</span>
          </div>
        </div>
      </section>
      <section className="workspace-showcase" aria-label="示例制作工作台">
        <div className="showcase-top">
          <span>
            <i />
            <i />
            <i />
          </span>
          <small>FRAMEFLOW / MORNING TVC PROJECT</small>
          <span className="demo-pill">演示界面</span>
        </div>
        <div className="showcase-body">
          <aside>
            <Clapperboard size={23} />
            {["产品资料", "创意策划", "资产制作", "视频制作"].map((v, i) => (
              <div key={v} className={i === 1 ? "selected" : ""}>
                {i === 1 ? <Sparkles size={15} /> : <Layers size={15} />}
                <span>{v}</span>
              </div>
            ))}
          </aside>
          <div className="showcase-main">
            <div className="showcase-heading">
              <div>
                <small>森野随行杯 / 30 秒 TVC 策划案</small>
                <h3>一个属于自己的早晨</h3>
              </div>
              <span className="demo-pill">工业分镜 · v3</span>
            </div>
            <div className="shot-demo">
              {["留一点时间给自己", "推开窗，让光进来", "把早晨，握在手里"].map(
                (v, i) => (
                  <div key={v}>
                    <ProductScene variant={i + 1} />
                    <div>
                      <small>
                        0{i + 1} / {i === 0 ? "全景" : "特写"} · 5s
                      </small>
                      <p>{v}</p>
                    </div>
                  </div>
                ),
              )}
            </div>
            <div className="demo-timeline">
              <span>00:00</span>
              <div>
                <i>环境与氛围</i>
                <i>产品细节</i>
                <i>品牌落版</i>
              </div>
              <span>00:15</span>
            </div>
          </div>
        </div>
        <div className="showcase-foot">
          <span>
            <Check size={14} /> 创意、分镜与资产，始终保持关联
          </span>
          <span>所有内容均为功能演示，不代表实际生成成果</span>
        </div>
      </section>
      <section id="workflow" className="ff-section">
        <div className="section-heading">
          <div>
            <span className="ff-kicker">01 / A CONNECTED WORKFLOW</span>
            <h2>
              一份产品需求，
              <br />
              六步走向完整 TVC。
            </h2>
          </div>
          <p>
            用「森野随行杯」这个虚构产品，
            <br />
            演示一支 30 秒 TVC 从需求到交付的制作流程。
          </p>
        </div>
        <div className="workflow-grid">
          {[
            [
              "01",
              "产品 Brief",
              "哑光绿杯身、通勤场景。把已知事实与创意假设分开，建立共同起点。",
            ],
            [
              "02",
              "创意与策划",
              "从“一个属于自己的早晨”出发，打磨钩子、叙述结构与情绪曲线。",
            ],
            [
              "03",
              "工业分镜",
              "窗边的晨光 → 杯身细节 → 手握随行杯。明确景别、运镜和声音。",
            ],
            [
              "04",
              "视觉资产",
              "锁定同一杯型、色彩与场景。人物、环境和道具都有可引用的版本。",
            ],
            [
              "05",
              "视频制作",
              "组合资产与提示词，先确认报价、人工审批，再提交视频生成。",
            ],
            [
              "06",
              "成片与追溯",
              "上传剪辑后的成片，关联来源片段，回看它所使用的每一版输入。",
            ],
          ].map(([n, t, d]) => (
            <article key={n}>
              <span className="step-no">{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="capabilities" className="ff-capabilities">
        <div className="ff-section">
          <span className="ff-kicker">02 / BUILT FOR YOUR CREATIVE TEAM</span>
          <h2>
            把精力留给创作。
            <br />
            <span>把协作交给 Frameflow。</span>
          </h2>
          <div className="capability-grid">
            {[
              [
                Workflow,
                "人定方向，Agent 接力",
                "批量发散、读取上下文、保存策划。你随时筛选、修改，接过创作的决定权。",
              ],
              [
                ShieldCheck,
                "每一次制作，心里有数",
                "生成前查看积分报价。视频批次由人审批，提示词、资产顺序和参数一起确认。",
              ],
              [
                History,
                "好结果，有迹可循",
                "历史修订保留原貌，上游变化会提醒下游。从一条成片找到当时的输入。",
              ],
              [
                Users,
                "一个团队，同一份上下文",
                "成员角色、团队资料和积分分配放在一起管理。不同团队的制作空间独立。",
              ],
            ].map(([Icon, title, description]: any) => (
              <article key={title}>
                <Icon size={25} />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="agents" className="ff-section agents-section">
        <div>
          <span className="ff-kicker">03 / AGENT, MEET YOUR WORKSPACE</span>
          <h2>
            你熟悉的 Agent，
            <br />
            也是团队的一员。
          </h2>
          <p>
            复制一段接入指令，把工作台交给你的 Agent。
            <br />
            同一套资料、同一条制作流程，每一步都能看见。
          </p>
          <ol>
            <li>
              <b>安装 Skill</b>
              <span>获取版本化能力说明和接口文档</span>
            </li>
            <li>
              <b>连接你的团队</b>
              <span>选择 API Key，明确权限与产品范围</span>
            </li>
            <li>
              <b>让成果留在平台</b>
              <span>创建产品、批量创意、提交制作与查询进度</span>
            </li>
          </ol>
          <Link
            className="ff-text-link"
            href="/skills/ai-video-platform/SKILL.md"
          >
            阅读接入指南 <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="agent-terminal">
          <div>
            <Terminal size={18} />
            <span>YOUR AGENT × FRAMEFLOW</span>
            <i />
          </div>
          <pre>
            <span># 01 安装平台 Skill</span>
            {"\n"}GET /skills/ai-video-platform/SKILL.md{"\n\n"}
            <span># 02 从本地私有环境读取凭据</span>
            {"\n"}AIVIDEO_BASE_URL=&lt;平台地址&gt;{"\n"}
            AIVIDEO_API_KEY=&lt;你的私有密钥&gt;{"\n\n"}
            <span># 03 验证身份与团队范围</span>
            {"\n"}GET /api/v1/auth/me{"\n\n"}
            <b>✓ 连接验证不调用付费模型</b>
          </pre>
          <p>密钥固定绑定团队。Agent 可以提交视频，审批由人完成。</p>
        </div>
      </section>
      <section id="faq" className="ff-section faq-section">
        <div>
          <span className="ff-kicker">04 / BEFORE YOUR FIRST FRAME</span>
          <h2>
            从第一份 Brief，
            <br />
            开始试一试。
          </h2>
          <div className="credit-offer">
            <span>首次注册赠送</span>
            <strong>
              20,000<small>积分</small>
            </strong>
            <p>
              放入初始团队，和成员一起使用。
              <br />
              不设到期时间，按采购成本扣分。
            </p>
            <Link href={target} className="ff-button">
              {cta}
              <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
        <div className="faq-list">
          {[
            [
              "Frameflow 用来制作什么？",
              "Frameflow 是面向品牌和产品的 TVC 广告片制作工作室，连接产品需求、Brief、创意策划、工业分镜、视觉资产与视频片段。剪辑完成的成片可上传并关联来源，保留每一步制作记录。",
            ],
            [
              "积分怎么算？",
              "AI 对话、附件理解和搜索免费；仅生图和生视频扣积分，1 元对应 100 积分。优先按供应商实际费用或核实采购价结算；缺价时默认每请求 1 元，明确标记临时估算。提交前报价，完成后结算。",
            ],
            [
              "创建多个团队，会重复赠送吗？",
              "不会。每个新用户仅在首次注册时向个人钱包赠送 20000 积分；另建团队或接受邀请不会再次发放。",
            ],
            [
              "Agent 可以直接生成视频吗？",
              "Agent 可以准备脚本和提交批次。视频必须由具有审核权限的人确认生成内容和报价后才会执行；改动内容或重新生成需要新审批。",
            ],
            [
              "生图或生视频时积分不足怎么办？",
              "积分不足时暂停并保留进度，管理员可分配或调整积分。模型缺价时使用默认估算价格，仍可生成；个人余额全平台通用。",
            ],
            [
              "可以使用已有的邮箱账号吗？",
              "可以。原有邮箱密码登录保留，也可以登录后在账号设置中验证并绑定手机号。手机号绑定不会自动合并账号。",
            ],
            [
              "成片可以追溯到哪些内容？",
              "可以关联来源片段、任务输入、引用资产版本、策划与分镜。上传成片时尚未关联来源，会明确标记追溯信息不完整。",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <Plus size={18} />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="ff-final">
        <span className="ff-kicker">YOUR NEXT IDEA STARTS HERE</span>
        <h2>
          你的下一支 TVC，
          <br />
          从这里开始。
        </h2>
        <Link href={target} className="ff-button">
          {cta}
          <ArrowUpRight size={20} />
        </Link>
        <Link className="final-login" href="/login">
          已有账号？登录工作台
        </Link>
      </section>
      <footer className="ff-footer">
        <Brand />
        <span>TVC 制作 · 从产品需求到完整广告片。</span>
        <div>
          <Link href="/skills/ai-video-platform/SKILL.md">Skill</Link>
          <Link href="/api/v1/openapi.json">接口文档</Link>
          <a href="#faq">常见问题</a>
          <a
            href={accountLinks.agreement}
            target="_blank"
            rel="noopener noreferrer"
          >
            产品用户协议
          </a>
          <a
            href={accountLinks.privacy}
            target="_blank"
            rel="noopener noreferrer"
          >
            隐私政策
          </a>
        </div>
        <small>© {new Date().getFullYear()} Frameflow</small>
      </footer>
    </main>
  );
}
