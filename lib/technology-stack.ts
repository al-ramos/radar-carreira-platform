type Technology={label:string;patterns:RegExp[]};

const technologies:Technology[]=[
  {label:".NET",patterns:[/(?:^|\W)\.net(?:\W|$)/i,/(?:^|\W)asp\.net(?:\W|$)/i]},
  {label:"C#",patterns:[/(?:^|\W)c#(?:\W|$)/i,/(?:^|\W)csharp(?:\W|$)/i]},
  {label:"SQL Server",patterns:[/\bsql\s*server\b/i,/(?:^|\W)mssql(?:\W|$)/i]},
  {label:"Node.js",patterns:[/\bnode(?:\.js|js)?\b/i]},
  {label:"TypeScript",patterns:[/\btypescript\b/i]},
  {label:"JavaScript",patterns:[/\bjavascript\b/i]},
  {label:"React",patterns:[/\breact(?:\.js|js)?\b/i]},
  {label:"Angular",patterns:[/\bangular\b/i]},
  {label:"Vue.js",patterns:[/\bvue(?:\.js|js)?\b/i]},
  {label:"Next.js",patterns:[/\bnext(?:\.js|js)?\b/i]},
  {label:"Java",patterns:[/\bjava\b/i]},
  {label:"Spring",patterns:[/\bspring(?:\s+boot)?\b/i]},
  {label:"Python",patterns:[/\bpython\b/i]},
  {label:"Django",patterns:[/\bdjango\b/i]},
  {label:"PHP",patterns:[/\bphp\b/i]},
  {label:"Laravel",patterns:[/\blaravel\b/i]},
  {label:"Ruby",patterns:[/\bruby\b/i]},
  {label:"Rails",patterns:[/\bruby\s+on\s+rails\b/i,/\brails\b/i]},
  {label:"Go",patterns:[/\bgolang\b/i]},
  {label:"Kotlin",patterns:[/\bkotlin\b/i]},
  {label:"Swift",patterns:[/\bswift\b/i]},
  {label:"PostgreSQL",patterns:[/\bpostgres(?:ql)?\b/i]},
  {label:"MySQL",patterns:[/\bmysql\b/i]},
  {label:"Oracle",patterns:[/\boracle\b/i]},
  {label:"MongoDB",patterns:[/\bmongodb\b/i]},
  {label:"Redis",patterns:[/\bredis\b/i]},
  {label:"AWS",patterns:[/(?:^|\W)aws(?:\W|$)/i,/\bamazon web services\b/i]},
  {label:"Azure",patterns:[/\bazure\b/i]},
  {label:"GCP",patterns:[/(?:^|\W)gcp(?:\W|$)/i,/\bgoogle cloud(?: platform)?\b/i]},
  {label:"Docker",patterns:[/\bdocker\b/i]},
  {label:"Kubernetes",patterns:[/\bkubernetes\b/i,/(?:^|\W)k8s(?:\W|$)/i]},
  {label:"Terraform",patterns:[/\bterraform\b/i]},
  {label:"Linux",patterns:[/\blinux\b/i]},
  {label:"Git",patterns:[/(?:^|\W)git(?:\W|$)/i]},
  {label:"REST",patterns:[/(?:^|\W)rest(?:ful)?(?:\W|$)/i]},
  {label:"GraphQL",patterns:[/\bgraphql\b/i]},
  {label:"Kafka",patterns:[/\bkafka\b/i]},
  {label:"Power BI",patterns:[/\bpower\s*bi\b/i]},
  {label:"SAP",patterns:[/(?:^|\W)sap(?:\W|$)/i]},
  {label:"Salesforce",patterns:[/\bsalesforce\b/i]},
  {label:"SIEM",patterns:[/(?:^|\W)siem(?:\W|$)/i]},
  {label:"SOC",patterns:[/(?:^|\W)soc(?:\W|$)/i]},
  {label:"IAM",patterns:[/(?:^|\W)iam(?:\W|$)/i]},
];

export function inferTechnologyStack(text:string,existing:string[]=[]){
  const result:string[]=[];
  const add=(label:string)=>{if(label.trim()&&!result.some(item=>item.toLocaleLowerCase("pt-BR")===label.trim().toLocaleLowerCase("pt-BR")))result.push(label.trim())};
  existing.forEach(add);
  for(const technology of technologies){if(technology.patterns.some(pattern=>pattern.test(text)))add(technology.label)}
  return result.slice(0,10);
}
