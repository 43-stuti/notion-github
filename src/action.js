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
const NOTION_TOKEN = core.getInput('NOTION_SECRET');
const OWNER = core.getInput('OWNER');
const REPO = core.getInput('REPO');
const BLOCK_NAME = core.getInput('BLOCK_NAME');
async function getPageUpdates() {
    console.log('fetching notion content');
    let response = await notion.search({
        query:BLOCK_NAME
    });
    if(response.results && response.results.length) {
        let blockId = response.results[0].id;
        await getBlockContent(blockId,BLOCK_NAME);
       
        await updateDoc();
        updateImages();
    } else {
        console.log('no data found for block:',BLOCK_NAME);
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
        owner:OWNER,
        repo:REPO,
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
        return axios.get("https://api.github.com/repos/"+OWNER+"/"+REPO+"/contents/"+filepath,{})
        .then(async(response) => {
            
            if(response.data.sha) {
                console.log('response')
                let del = await octokit2.rest.repos.deleteFile({
                    owner: OWNER,
                    repo: REPO,
                    path:path+'/'+filename,
                    message:'delete files',
                    sha:response.data.sha,
                });
                console.log('delete')
                return true
            }
            return true
        })
        .catch((error) => {
            console.log('ERROR',error);
            return true;
        })
    }  


    let tree = await octokit2.rest.git.createTree({
        tree: treeContent,
        owner:OWNER,
        repo:REPO
    });
    let commit = await octokit2.rest.git.createCommit({
                    owner:OWNER,
                    repo:REPO,
                    tree:tree.data.sha,
                    message:message
                })          
    let update = await octokit2.rest.git.updateRef({
        owner:OWNER,
        repo:REPO,
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
                owner:OWNER,
                repo:REPO,
                base:'master',
                head:branch,
            });
}
//
async function onStart() {
    octokit2 = github.getOctokit(GITHUB_TOKEN);
    notion = new Client({ auth: NOTION_TOKEN })
    const { context = {} } = github;
    getPageUpdates();
}
onStart()