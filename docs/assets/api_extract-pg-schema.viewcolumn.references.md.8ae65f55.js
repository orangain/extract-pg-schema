import{_ as e,c as t,o as a,N as r}from"./chunks/framework.2bebdaf8.js";const u=JSON.parse('{"title":"","description":"","frontmatter":{},"headers":[],"relativePath":"api/extract-pg-schema.viewcolumn.references.md"}'),s={name:"api/extract-pg-schema.viewcolumn.references.md"},n=r(`<p><a href="./">Home</a> &gt; <a href="./extract-pg-schema.html">extract-pg-schema</a> &gt; <a href="./extract-pg-schema.viewcolumn.html">ViewColumn</a> &gt; <a href="./extract-pg-schema.viewcolumn.references.html">references</a></p><h2 id="viewcolumn-references-property" tabindex="-1">ViewColumn.references property <a class="header-anchor" href="#viewcolumn-references-property" aria-label="Permalink to &quot;ViewColumn.references property&quot;">​</a></h2><p>If views are resolved, this will contain the references from the source column in the table that this view references. Note that if the source is another view, that view in turn will be resolved if possible, leading us to a table in the end.</p><p><strong>Signature:</strong></p><div class="language-typescript"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki material-theme-palenight"><code><span class="line"><span style="color:#A6ACCD;">references</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> ColumnReference[]</span><span style="color:#89DDFF;">;</span></span>
<span class="line"></span></code></pre></div>`,5),c=[n];function o(l,i,p,h,m,f){return a(),t("div",null,c)}const d=e(s,[["render",o]]);export{u as __pageData,d as default};
