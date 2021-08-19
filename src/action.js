const pkg1 = require('@notionhq/client');
const axios =  require('axios');
const pkg2 = require('@octokit/rest');
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs')
const { Client } = pkg1;
const { Octokit } = pkg2;

let notion;
let octokit2;

const owner = 'stuti-43'
let repo;
let main;
let treeItems = [];
let treeItemsImg = [];
let fileNames = [];
let imageUrls = [];
let contentArray = [];
const GITHUB_TOKEN = core.getInput('SECRET_GITHUB');
const NOTION_TOKEN = core.getInput('NOTION_SECRET')
async function getPageUpdates() {
    let response = await notion.search({
        query:'what'
    });
    if(response.results && response.results.length) {
        let blockId = response.results[0].id;
        await getBlockContent(blockId,'what');
       
        await updateDoc();
        updateImages();
    }
    
}


async function getBlockContent(id,name) {
    let pageblock = await notion.blocks.children.list({
        block_id: id
    });
    let string = '';
    if(pageblock.results && pageblock.results.length) {
        for(let i=0;i<pageblock.results.length;i++) {
            let obj = pageblock.results[i];
            if(obj.type == 'child_page') {
                await getBlockContent(obj.id,obj[obj.type].title);
            } else {
                
                if(obj[obj.type] && obj[obj.type] && obj[obj.type].text) {
                    for(let i=0;i<obj[obj.type].text.length;i++) {
                        let text = obj[obj.type].text[i];
                        if(obj[obj.type].text[i]['href']) {
                            string = string + '[' + obj[obj.type].text[i]['plain_text'] + ']';
                            string = string + '(' + obj[obj.type].text[i]['href'] + ')' + '\n';
                        } else {
                            if(obj.type == 'heading_1') {
                                string = string + '# ';
                            }
                            if(obj.type == 'heading_2') {
                                string = string + '## ';
                            }
                            if(obj.type == 'heading_3') {
                                string = string + '### ';
                            }
                            if(obj.type == 'heading_4') {
                                string = string + '#### ';
                            }
                            if(obj.type == 'heading_5') {
                                string = string + '##### ';
                            }
                            if(obj.type == 'heading_6') {
                                string = string + '###### ';
                            }
                            if(obj.type == 'bulleted_list_item') {
                                string = string + '* ';
                            }
                            string = string + obj[obj.type].text[i]['plain_text'] + '\n';
                        }
                        
                    }
                }
                if(obj.type == 'unsupported') {
                    if(obj.image && obj.image.url) {
                        string = string + '[]';
                        string = string + '(' + obj.image.url + ')' + '\n';
                        console.log('MADE STRING')
                        imageUrls.push({
                            base:name,
                            url:obj.image.url
                        });
                    }
                }
            }
        }
        contentArray.push({
            string:string,
            base:name
        })
        
    }

}

async function updateDoc() {
    let addtotree = async(obj) => {
        fileNames.push(obj.base+'.md')
        await prepareTree(Buffer.from(obj.string).toString('base64'),'content_script/'+obj.base+'.md',treeItems);
    }
    let promiseArr = []
    for (let i = 0; i < contentArray.length; i++) {
        promiseArr.push(addtotree(contentArray[i]));
      }
    await Promise.all(promiseArr);
    await updateRef(treeItems,'Notion doc update','docs','content_script',fileNames)
}
async function updateImages() {
    let deleteFiles = [];
    let getImg = async(img,i) => {
        return axios
        .get(img.url, {
        responseType: 'arraybuffer'
        })
        .then(async response => {
            console.log('get response');
            deleteFiles.push(img.base+'_'+i+'.png')
            await prepareTree(Buffer.from(response.data, 'binary').toString('base64'),'images_script/'+img.base+'_'+i+'.png',treeItemsImg);
            return true;
        })
        .catch(err => {
            console.log('error image',err);
            return true;
        })
    }
    let promiseArr = []
    for (let i = 0; i < imageUrls.length; i++) {
        promiseArr.push(getImg(imageUrls[i],i));
      }
    await Promise.all(promiseArr);
    await updateRef(treeItemsImg,'Notion img update','imgs','images_script',deleteFiles);
}

//github utils
async function prepareTree(content,path,array) {
    let blob = await octokit2.rest.git.createBlob({
        owner:'luisaph',
        repo:'the-code-of-music',
        content:content,
        encoding:'base64'
      });
    //repo.git.blobs.create({ content: Buffer.from(string).toString('base64') });
    array.push({
        path: path,
        sha: blob.data.sha,
        mode: "100644",
        type: "blob"
    });
}
async function updateRef(treeContent,message,branch,path,deleteArray) {
    let deleteFunc = async (filename) => {
        let filepath = path+"/"+filename;
        console.log('file',filepath);
        return axios.get("https://api.github.com/repos/luisaph/the-code-of-music/contents/content_script/what.md",{})
        .then(async(response) => {
            
            if(response.data.sha) {
                console.log('response')
                /*let del = await octokit2.rest.repos.deleteFile({
                    owner: 'luisaph',
                    repo: 'the-code-of-music',
                    path:path+'/'+filename,
                    message:'delete files',
                    sha:response.data.sha,
                });
                console.log('delete')*/
                return true
            }
            return true
        })
        .catch((error) => {
            console.log('ERROR');
            return true;
        })
    }  


    let tree = await octokit2.rest.git.createTree({
        tree: treeContent,
        owner:'luisaph',
        repo:'the-code-of-music'
    });
    let commit = await octokit2.rest.git.createCommit({
                    owner:'luisaph',
                    repo:'the-code-of-music',
                    tree:tree.data.sha,
                    message:message
                })          
    let update = await octokit2.rest.git.updateRef({
        owner:'luisaph',
        repo:'the-code-of-music',
        ref:'heads/'+branch,
        path:path,
        sha:commit.data.sha,
        force:true
    }); 
    let promises = [];
    for (let i = 0; i < deleteArray.length; i++) {
        promises.push(deleteFunc(deleteArray[i]));
      }
    await Promise.all(promises);
    let merge = octokit2.rest.repos.merge({
                owner:'luisaph',
                repo:'the-code-of-music',
                base:'master',
                head:branch,
            });
}
//
async function onStart() {
    console.log('start');
    octokit2 = github.getOctokit(GITHUB_TOKEN);
    notion = new Client({ auth: NOTION_TOKEN })
    const { context = {} } = github;
    getPageUpdates();
    /*fs.readFile('creds.json',async(err,content) => {
        if(err) {
            console.log('error reading file',err);
        } else {
            let keys = JSON.parse(content)
            notion = new Client({ auth: keys.notion })
            octokit2 = new Octokit({ auth: keys.github });
            getPageUpdates();
        }
    })*/
}
onStart()